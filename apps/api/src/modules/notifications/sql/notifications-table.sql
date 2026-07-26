-- 通知表
CREATE TABLE IF NOT EXISTS Notification (
  id TEXT PRIMARY KEY,
  clinicId TEXT NOT NULL,
  userId TEXT,
  type TEXT NOT NULL CHECK (type IN ('system','appointment','charge','inventory','patient','clinical','financial','equipment')),
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low','normal','high','urgent')),
  readAt TEXT,
  data TEXT,
  createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
  updatedAt TEXT DEFAULT CURRENT_TIMESTAMP,
  deletedAt TEXT,
  FOREIGN KEY (clinicId) REFERENCES Clinic(id),
  FOREIGN KEY (userId) REFERENCES User(id)
);

-- 索引
CREATE INDEX IF NOT EXISTS idx_notification_clinic ON Notification(clinicId);
CREATE INDEX IF NOT EXISTS idx_notification_user ON Notification(userId);
CREATE INDEX IF NOT EXISTS idx_notification_type ON Notification(type);
CREATE INDEX IF NOT EXISTS idx_notification_priority ON Notification(priority);
CREATE INDEX IF NOT EXISTS idx_notification_read ON Notification(readAt);
CREATE INDEX IF NOT EXISTS idx_notification_created ON Notification(createdAt DESC);
CREATE INDEX IF NOT EXISTS idx_notification_clinic_user_created ON Notification(clinicId, userId, createdAt DESC);
CREATE INDEX IF NOT EXISTS idx_notification_clinic_user_read ON Notification(clinicId, userId, readAt);
CREATE INDEX IF NOT EXISTS idx_notification_clinic_deleted_created ON Notification(clinicId, deletedAt, createdAt DESC);
