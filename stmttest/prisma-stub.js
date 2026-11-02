"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.prisma = void 0;
// The statement module needs Prisma for `buildStatement`, which these tests do
// not exercise (it is covered live against the database). Stubbing the import
// lets the pure CSV helpers compile standalone.
const prisma = {};
exports.prisma = prisma;
