const { ClinicContextService } = require('./src/common/services/clinic-context.service');

const instance = new ClinicContextService();

const testContext = {
  clinicId: 'test-clinic-001',
  userId: 'test-user-001',
  role: 'BOSS',
};

const originalGetClinicId = instance.getClinicId.bind(instance);
instance.getClinicId = function() {
  const result = originalGetClinicId();
  return result !== null ? result : testContext.clinicId;
};

const originalGetUserId = instance.getUserId.bind(instance);
instance.getUserId = function() {
  const result = originalGetUserId();
  return result !== null ? result : testContext.userId;
};

const originalGetRole = instance.getRole.bind(instance);
instance.getRole = function() {
  const result = originalGetRole();
  return result !== null ? result : testContext.role;
};

const originalIsInitialized = instance.isInitialized.bind(instance);
instance.isInitialized = function() {
  return originalIsInitialized() || true;
};

afterEach(() => {
  // 恢复 jest.setup 中创建的已 patch 单例，防止测试代码中 new ClinicContextService()
  // 覆盖全局单例后造成测试间污染。
  ClinicContextService.instance = instance;
});

module.exports = {};
