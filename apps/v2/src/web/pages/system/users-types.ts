export type UserRow = Record<string, unknown> & {
  id: string;
  username: string;
  name: string;
  role: string;
  phone?: string | null;
  active: boolean;
};

export interface UserRoleRow {
  userId: string;
  role: string;
}

export interface UserForm {
  username: string;
  password: string;
  name: string;
  role: string;
  phone: string;
  active: boolean;
}

export const emptyForm: UserForm = {
  username: '',
  password: '',
  name: '',
  role: 'DOCTOR',
  phone: '',
  active: true,
};

export const USER_PAGE_SIZE = 100;
