// The statement module needs Prisma for `buildStatement`, which these tests do
// not exercise (it is covered live against the database). Stubbing the import
// lets the pure CSV helpers compile standalone.
const prisma: any = {};
export { prisma };