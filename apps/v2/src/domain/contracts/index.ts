// Domain contracts barrel（M-04：由单文件 contracts.ts 拆分）。
// 保持 `from '...domain/contracts'` 导入兼容（96 个调用方）。
export * from './shared';
export * from './enums';
export * from './entities';
export * from './ports';
export * from './resources';
