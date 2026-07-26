import { toast } from 'sonner';

export const toastService = {
  success: (message: string, description?: string) => {
    toast.success(message, { description });
  },

  error: (message: string, error?: Error) => {
    const description = error?.message || undefined;
    toast.error(message, { description });
  },

  warning: (message: string, description?: string) => {
    toast.warning(message, { description });
  },

  info: (message: string, description?: string) => {
    toast.info(message, { description });
  },

  createSuccess: (itemName: string) => {
    toast.success(`${itemName}创建成功`);
  },

  updateSuccess: (itemName: string) => {
    toast.success(`${itemName}更新成功`);
  },

  deleteSuccess: (itemName: string) => {
    toast.success(`${itemName}删除成功`);
  },

  createError: (itemName: string, error?: Error) => {
    toast.error(`${itemName}创建失败`, { description: error?.message });
  },

  updateError: (itemName: string, error?: Error) => {
    toast.error(`${itemName}更新失败`, { description: error?.message });
  },

  deleteError: (itemName: string, error?: Error) => {
    toast.error(`${itemName}删除失败`, { description: error?.message });
  },

  validationError: (field: string, message: string) => {
    toast.error(`${field} ${message}`);
  },

  networkError: () => {
    toast.error('网络请求失败，请检查网络连接');
  },

  unauthorized: () => {
    toast.error('登录已过期，请重新登录');
  },
};
