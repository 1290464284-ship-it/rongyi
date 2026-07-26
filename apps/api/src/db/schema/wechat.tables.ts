export const wechatTables = [
  `CREATE TABLE IF NOT EXISTS WechatMessage (
      id TEXT PRIMARY KEY,
      patientId TEXT,
      patientName TEXT,
      openId TEXT,
      content TEXT NOT NULL,
      type TEXT NOT NULL,
      templateId TEXT,
      status TEXT DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'SENT', 'FAILED')),
      sentAt TEXT,
      remark TEXT,
      clinicId TEXT NOT NULL,
      createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
      updatedAt TEXT DEFAULT CURRENT_TIMESTAMP,
      deletedAt TEXT,
      FOREIGN KEY (patientId) REFERENCES Patient(id)
    )`,
];
