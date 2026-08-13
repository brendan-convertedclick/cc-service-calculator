import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { orderChildrenBySteps, type DeptChild } from "./dept-sequence.ts";

const CONTENT = "dept-content";
const CREATIVE = "dept-creative";
const DEV = "dept-dev";

const children: DeptChild[] = [
  { deptId: DEV, deptName: "Development", taskId: "t-dev" },
  { deptId: CONTENT, deptName: "Content & Copywriting", taskId: "t-content" },
  { deptId: CREATIVE, deptName: "Creative Production", taskId: "t-creative" },
];

// A "New Website Page" procedure: copy first, then design, then build.
const steps = [
  { department_id: CONTENT, ordinal: 1 },
  { department_id: CONTENT, ordinal: 2 },
  { department_id: CREATIVE, ordinal: 3 },
  { department_id: DEV, ordinal: 4 },
  { department_id: DEV, ordinal: 5 },
];

Deno.test("orders departments by their earliest step, not by how the children arrived", () => {
  assertEquals(
    orderChildrenBySteps(children, steps).map((c) => c.taskId),
    ["t-content", "t-creative", "t-dev"],
  );
});

Deno.test("drops a department the procedure never mentions", () => {
  assertEquals(
    orderChildrenBySteps(children, [{ department_id: CONTENT, ordinal: 1 }]).map((c) => c.taskId),
    ["t-content"],
  );
});

Deno.test("no department on any step means no chain at all", () => {
  assertEquals(orderChildrenBySteps(children, [{ department_id: null, ordinal: 1 }]), []);
});

Deno.test("keeps duplicate departments adjacent, in arrival order", () => {
  const twice: DeptChild[] = [
    { deptId: DEV, deptName: "Development", taskId: "t-dev-line2" },
    { deptId: CONTENT, deptName: "Content & Copywriting", taskId: "t-content" },
    { deptId: DEV, deptName: "Development", taskId: "t-dev-line1" },
  ];
  assertEquals(
    orderChildrenBySteps(twice, steps).map((c) => c.taskId),
    ["t-content", "t-dev-line2", "t-dev-line1"],
  );
});
