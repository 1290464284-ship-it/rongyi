// Express Request 类型扩展，添加 req.user 属性
declare namespace Express {
  interface User {
    id: string;
    username: string;
    name: string;
    role: "BOSS" | "DOCTOR" | "RECEPTIONIST";
    [key: string]: unknown;
  }

  interface Request {
    user?: User;
  }
}
