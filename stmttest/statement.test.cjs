/* Regression tests for the statement CSV renderer and account limits. */
const assert = require("node:assert/strict");
const {
  toCsv,
  statementFilename,
  roundMoney,
  roundPrice,
} = require("./statement.js");
const { ACCOUNT_LIMITS, tierFor, formatDailyLimit } = require("./account-limits.js");

let passed = 0;
const failures = [];

function test(name, fn) {
  try {
    fn();
    passed += 1;
  } catch (error) {
    failures.push(`${name}: ${error.message}`);
  }
}

const ISO = "2026-10-06T12:34:56.000Z";

const row = (over = {}) => ({
  date: new Date(ISO),
  type: "DEPOSIT",
  asset: "USD",
  amount: 1000,
  price: null,
  status: "COMPLETED",
  ...over,
});

/** The header plus one row (or just the header when the second arg is false). */
const dataLines = (csv) => csv.split("\r\n").filter((line) => line !== "");

/* --------------------------------- header --------------------------------- */

test("emits the required columns in order", () => {
  assert.equal(dataLines(toCsv([]))[0], "Date,Type,Asset,Amount,Price,Status");
});

test("an empty account still yields a header row", () => {
  const lines = dataLines(toCsv([]));
  assert.equal(lines.length, 1, `expected only a header, got ${lines.length}`);
});

test("uses CRLF and ends with a trailing newline", () => {
  const csv = toCsv([row()]);
  assert.ok(csv.endsWith("\r\n"), "should end with a newline");
  assert.ok(csv.includes("\r\n"), "should use CRLF separators");
  assert.ok(!/[^\r]\n/.test(csv), "must not mix bare LF line endings");
});

/* --------------------------------- cells ---------------------------------- */

test("fields are written unquoted when they need no quoting", () => {
  assert.ok(toCsv([row()]).includes(`${ISO},DEPOSIT,USD,1000,,COMPLETED`));
});

test("a price is emitted only for trades", () => {
  const csv = toCsv([row({ type: "BUY", asset: "AAPL", price: 332.25, amount: 1993.5 })]);
  assert.ok(csv.includes(",BUY,AAPL,1993.5,332.25,"), csv);
});

test("not-applicable cells are empty, not zero", () => {
  const line = dataLines(toCsv([row({ price: null, amount: null })]))[1];
  const cells = line.split(",");
  assert.equal(cells.length, 6, `expected 6 cells: ${line}`);
  assert.equal(cells[3], "", `amount cell must be empty: ${line}`);
  assert.equal(cells[4], "", `price cell must be empty: ${line}`);
  assert.equal(cells[3], "", "must not fabricate a 0 for a not-applicable value");
});

test("a real zero is still written as 0", () => {
  const cells = dataLines(toCsv([row({ amount: 0 })]))[1].split(",");
  assert.equal(cells[3], "0");
});

test("commas, quotes and newlines are escaped per RFC 4180", () => {
  const csv = toCsv([
    row({ asset: "A,B", status: 'SAY "HI"' }),
    row({ asset: "line1\nline2" }),
  ]);
  assert.ok(csv.includes('"A,B"'), "comma field must be quoted");
  assert.ok(csv.includes('"SAY ""HI"""'), "quotes must be doubled");
  assert.ok(csv.includes('"line1\nline2"'), "embedded newline must be quoted");
});

test("an embedded newline does not split the row that follows it", () => {
  const lines = dataLines(toCsv([
    row({ asset: "line1\nline2" }),
    row({ type: "SELL", asset: "MSFT" }),
  ]));
  assert.equal(lines.length, 3, `quoted newline leaked as a row break: ${lines.length}`);
  assert.ok(lines[2].includes(",SELL,MSFT,1000,,COMPLETED"), lines[2]);
});

test("an asset with quote and comma cannot corrupt a neighbour", () => {
  const lines = dataLines(toCsv([
    row({ asset: 'A"B,C' }),
    row({ type: "SELL", asset: "MSFT" }),
  ]));
  assert.equal(lines.length, 3, "quoted cell must not leak a delimiter");
  assert.ok(lines[1].includes('"A""B,C"'), lines[1]);
  assert.equal(lines[2].split(",").length, 6, `neighbour cell count: ${lines[2]}`);
  assert.ok(lines[2].includes(",SELL,MSFT,1000,,COMPLETED"), lines[2]);
});

test("rows are not reordered by the renderer", () => {
  const lines = dataLines(toCsv([
    row({ asset: "FIRST", date: new Date("2026-10-01T00:00:00Z") }),
    row({ asset: "SECOND", date: new Date("2026-10-02T00:00:00Z") }),
  ]));
  assert.ok(lines[1].includes("FIRST"), "ordering is the caller's responsibility");
  assert.ok(lines[2].includes("SECOND"));
});

/* --------------------------- values stay numeric --------------------------- */

test("amounts and prices are written raw (no $ or separators)", () => {
  const line = dataLines(toCsv([row({ type: "BUY", amount: 1234.5, price: 0.000123 })]))[1];
  assert.ok(line.includes(",1234.5,0.000123,"), line);
  assert.ok(!line.includes("$"), "no currency symbol");
  assert.equal(line.split(",").length, 6, `no thousand separators inside a cell: ${line}`);
});

test("renderer passes numbers through verbatim (rounding happens upstream)", () => {
  // toCsv must not re-round: buildStatement owns precision, and a second
  // rounding pass here would silently disagree with the ledger.
  const line = dataLines(toCsv([
    row({ type: "BUY", amount: 1993.4999999999998, price: 0.1 + 0.2 }),
  ]))[1];
  assert.ok(
    line.includes(",1993.4999999999998,0.30000000000000004,"),
    `expected verbatim values: ${line}`,
  );
});

test("very small crypto prices keep their precision", () => {
  const line = dataLines(toCsv([
    row({ type: "BUY", price: 0.00001234, amount: 1.23 }),
  ]))[1];
  assert.ok(line.includes(",1.23,0.00001234,"), `price was truncated: ${line}`);
});

test("a sub-satoshi price does not round to a fabricated zero", () => {
  const cells = dataLines(toCsv([
    row({ type: "BUY", price: 0.00000001, amount: 1 }),
  ]))[1].split(",");
  assert.notEqual(cells[4], "", "price cell must not be empty");
  assert.notEqual(Number(cells[4]), 0, `price rounded to zero: "${cells[4]}"`);
  assert.equal(Number(cells[4]), 0.00000001, `price misstated: "${cells[4]}"`);
});

test("equity prices are not padded with trailing zeros", () => {
  const line = dataLines(toCsv([
    row({ type: "BUY", price: 332.25, amount: 1 }),
  ]))[1];
  assert.ok(!line.includes("332.250000"), `must not pad: ${line}`);
});

/* --------------------------- precision ownership --------------------------- */

test("roundMoney trims float artifacts to 2dp", () => {
  assert.equal(roundMoney(1993.4999999999998), 1993.5);
  assert.equal(roundMoney(0.1 + 0.2), 0.3);
  assert.equal(roundMoney(1234.567), 1234.57);
  assert.equal(roundMoney(1000), 1000);
});

test("a value rounding to zero still writes as 0, never -0", () => {
  // String(-0) is "0", but assert it so the CSV can never emit "-0".
  assert.equal(String(roundMoney(-0.001)), "0");
});

test("roundPrice keeps crypto precision", () => {
  assert.equal(roundPrice(0.00001234), 0.00001234);
  assert.equal(roundPrice(0.000000129), 0.00000013);
});

test("roundPrice does not pad equities with trailing zeros", () => {
  assert.equal(String(roundPrice(332.25)), "332.25");
  assert.equal(roundPrice(150.5), 150.5);
});

test("roundPrice strips artifacts without hitting zero", () => {
  assert.equal(roundPrice(0.1 + 0.2), 0.3);
  assert.equal(roundPrice(0.00000001), 0.00000001);
  assert.notEqual(roundPrice(0.00000001), 0);
});

test("regression: 6dp truncated a crypto price, so price uses 8dp", () => {
  // The original implementation used toFixed(6), which silently turned this
  // into 0.000012 and misstated the fill.
  assert.equal(Number((0.00001234).toFixed(6)), 0.000012);
  assert.notEqual(roundPrice(0.00001234), 0.000012);
});

/* -------------------------------- filename -------------------------------- */

test("filename carries the requested date", () => {
  assert.equal(
    statementFilename(new Date("2026-10-06T12:00:00Z")),
    "bulkinvest-statement-2026-10-06.csv",
  );
});

test("filename is CSV with no illegal characters", () => {
  assert.match(statementFilename(), /^bulkinvest-statement-\d{4}-\d{2}-\d{2}\.csv$/);
});

/* ------------------------------ account limits ---------------------------- */

test("tier limits are the required values", () => {
  assert.equal(ACCOUNT_LIMITS.unverified, 1_000);
  assert.equal(ACCOUNT_LIMITS.verified, 50_000);
});

test("tier is derived from verification state", () => {
  assert.equal(tierFor(false), "unverified");
  assert.equal(tierFor(true), "verified");
});

test("limits format without decimals", () => {
  assert.equal(formatDailyLimit(ACCOUNT_LIMITS.unverified), "$1,000");
  assert.equal(formatDailyLimit(ACCOUNT_LIMITS.verified), "$50,000");
});

/* --------------------------------- report --------------------------------- */

console.log(`${passed} passed, ${failures.length} failed`);
for (const failure of failures) console.log(`  FAIL ${failure}`);
process.exit(failures.length === 0 ? 0 : 1);
