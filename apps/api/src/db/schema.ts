import { db } from './database';

const SCHEMA_LOGGER = {
  warn: (msg: string, err?: unknown) => {
    try {
      console.warn(`[Schema] ${msg}`, err ? (err as Error)?.message || err : '');
    } catch (logErr) {
      // 最底层的日志，无法再上报，静默忽略
      // 但至少要确保不会因为日志本身的错误导致程序崩溃
    }
  },
};

/** 创建索引（如果不存在） */
const createIndexIfNotExists = (name: string, table: string, columns: string) => {
  try {
    db.exec(`CREATE INDEX IF NOT EXISTS ${name} ON ${table}(${columns})`);
  } catch (err) {
    SCHEMA_LOGGER.warn(`创建索引失败: ${name} ON ${table}`, err);
  }
};

export const createSchema = () => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS Clinic (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      code TEXT UNIQUE NOT NULL,
      address TEXT,
      phone TEXT,
      legalPerson TEXT,
      businessLicense TEXT,
      isActive INTEGER DEFAULT 1 CHECK (isActive IN (0,1)),
      remark TEXT,
      createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
      updatedAt TEXT DEFAULT CURRENT_TIMESTAMP,
      deletedAt TEXT
    );

    CREATE TABLE IF NOT EXISTS User (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      passwordHash TEXT NOT NULL,
      name TEXT NOT NULL,
      role TEXT DEFAULT 'RECEPTIONIST' CHECK (role IN ('BOSS','DOCTOR','RECEPTIONIST','NURSE','ADMIN')),
      phone TEXT,
      active INTEGER DEFAULT 1 CHECK (active IN (0,1)),
      loginAttempts INTEGER DEFAULT 0 CHECK (loginAttempts >= 0),
      lockedUntil TEXT,
      passwordNeedsRehash INTEGER DEFAULT 0,
      tokenVersion INTEGER DEFAULT 0,
      refreshToken TEXT,
      refreshTokenExpiresAt TEXT,
      clinicId TEXT,
      createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
      updatedAt TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (clinicId) REFERENCES Clinic(id)
    );

    CREATE TABLE IF NOT EXISTS UsedRefreshToken (
      tokenHash TEXT PRIMARY KEY,
      userId TEXT NOT NULL,
      usedAt TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (userId) REFERENCES User(id)
    );

    CREATE TABLE IF NOT EXISTS Patient (
      id TEXT PRIMARY KEY,
      code TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      gender TEXT NOT NULL CHECK (gender IN ('MALE','FEMALE','UNKNOWN')),
      birthDate TEXT,
      phone TEXT NOT NULL,
      idCard TEXT,
      address TEXT,
      occupation TEXT,
      remark TEXT,
      avatar TEXT,
      tags TEXT DEFAULT '[]',
      allergies TEXT DEFAULT '[]',
      medicalHistory TEXT DEFAULT '[]',
      medicationHistory TEXT DEFAULT '[]',
      systemicDiseases TEXT DEFAULT '[]',
      source TEXT DEFAULT 'WALK_IN',
      familyId TEXT,
      referrer TEXT,
      emergencyContact TEXT,
      emergencyPhone TEXT,
      openId TEXT,
      clinicId TEXT,
      active INTEGER DEFAULT 1 CHECK (active IN (0,1)),
      createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
      updatedAt TEXT DEFAULT CURRENT_TIMESTAMP,
      deletedAt TEXT,
      FOREIGN KEY (familyId) REFERENCES Family(id),
      FOREIGN KEY (clinicId) REFERENCES Clinic(id)
    );

    CREATE TABLE IF NOT EXISTS Family (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      createdAt TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS FollowUp (
      id TEXT PRIMARY KEY,
      patientId TEXT NOT NULL,
      planDate TEXT NOT NULL,
      content TEXT,
      status TEXT DEFAULT 'PENDING',
      result TEXT,
      assigneeId TEXT,
      completedAt TEXT,
      createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
      updatedAt TEXT DEFAULT CURRENT_TIMESTAMP,
      deletedAt TEXT,
      FOREIGN KEY (patientId) REFERENCES Patient(id),
      FOREIGN KEY (assigneeId) REFERENCES User(id)
    );

    CREATE TABLE IF NOT EXISTS Appointment (
      id TEXT PRIMARY KEY,
      patientId TEXT NOT NULL,
      doctorId TEXT NOT NULL,
      chairId TEXT,
      startTime TEXT NOT NULL,
      endTime TEXT NOT NULL,
      status TEXT DEFAULT 'BOOKED',
      type TEXT NOT NULL,
      remark TEXT,
      visitId TEXT,
      createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
      updatedAt TEXT DEFAULT CURRENT_TIMESTAMP,
      deletedAt TEXT,
      FOREIGN KEY (patientId) REFERENCES Patient(id),
      FOREIGN KEY (doctorId) REFERENCES User(id),
      FOREIGN KEY (chairId) REFERENCES Chair(id),
      FOREIGN KEY (visitId) REFERENCES Visit(id)
    );

    CREATE TABLE IF NOT EXISTS Chair (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      location TEXT,
      active INTEGER DEFAULT 1 CHECK (active IN (0,1)),
      createdAt TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS Visit (
      id TEXT PRIMARY KEY,
      patientId TEXT NOT NULL,
      appointmentId TEXT UNIQUE,
      doctorId TEXT NOT NULL,
      chiefComplaint TEXT,
      diagnosis TEXT,
      treatmentPlan TEXT,
      startTime TEXT DEFAULT CURRENT_TIMESTAMP,
      endTime TEXT,
      status TEXT DEFAULT 'IN_PROGRESS',
      createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
      updatedAt TEXT DEFAULT CURRENT_TIMESTAMP,
      deletedAt TEXT,
      FOREIGN KEY (patientId) REFERENCES Patient(id),
      FOREIGN KEY (appointmentId) REFERENCES Appointment(id),
      FOREIGN KEY (doctorId) REFERENCES User(id)
    );

    CREATE TABLE IF NOT EXISTS ToothRecord (
      id TEXT PRIMARY KEY,
      patientId TEXT NOT NULL,
      toothNumber INTEGER NOT NULL CHECK (toothNumber >= 1 AND toothNumber <= 55),
      currentStatus TEXT DEFAULT 'SOUND',
      conditions TEXT DEFAULT '[]',
      remark TEXT,
      createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
      updatedAt TEXT DEFAULT CURRENT_TIMESTAMP,
      deletedAt TEXT,
      UNIQUE(patientId, toothNumber),
      FOREIGN KEY (patientId) REFERENCES Patient(id)
    );

    CREATE TABLE IF NOT EXISTS Treatment (
      id TEXT PRIMARY KEY,
      patientId TEXT NOT NULL,
      visitId TEXT,
      doctorId TEXT NOT NULL,
      code TEXT NOT NULL,
      name TEXT NOT NULL,
      category TEXT NOT NULL,
      price REAL NOT NULL CHECK (price >= 0),
      quantity INTEGER DEFAULT 1 CHECK (quantity >= 1),
      teethNumbers TEXT DEFAULT '[]',
      status TEXT DEFAULT 'PLANNED',
      plannedDate TEXT,
      completedDate TEXT,
      remark TEXT,
      createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
      updatedAt TEXT DEFAULT CURRENT_TIMESTAMP,
      deletedAt TEXT,
      FOREIGN KEY (patientId) REFERENCES Patient(id),
      FOREIGN KEY (visitId) REFERENCES Visit(id),
      FOREIGN KEY (doctorId) REFERENCES User(id)
    );

    CREATE TABLE IF NOT EXISTS TreatmentCatalog (
      id TEXT PRIMARY KEY,
      code TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      category TEXT NOT NULL,
      price REAL NOT NULL CHECK (price >= 0),
      remark TEXT,
      createdAt TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS Charge (
      id TEXT PRIMARY KEY,
      patientId TEXT NOT NULL,
      visitId TEXT,
      doctorId TEXT,
      number TEXT UNIQUE NOT NULL,
      totalAmount REAL NOT NULL CHECK (totalAmount >= 0),
      paidAmount REAL DEFAULT 0 CHECK (paidAmount >= 0),
      refundedAmount REAL DEFAULT 0 CHECK (refundedAmount >= 0),
      discount REAL DEFAULT 0 CHECK (discount >= 0),
      status TEXT DEFAULT 'UNPAID',
      payMethod TEXT,
      paidAt TEXT,
      remark TEXT,
      createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
      updatedAt TEXT DEFAULT CURRENT_TIMESTAMP,
      deletedAt TEXT,
      FOREIGN KEY (patientId) REFERENCES Patient(id),
      FOREIGN KEY (visitId) REFERENCES Visit(id),
      FOREIGN KEY (doctorId) REFERENCES User(id)
    );

    CREATE TABLE IF NOT EXISTS ChargeItem (
      id TEXT PRIMARY KEY,
      chargeId TEXT NOT NULL,
      treatmentId TEXT,
      inventoryItemId TEXT,
      consumedQuantity REAL DEFAULT 0,
      name TEXT NOT NULL,
      category TEXT NOT NULL,
      price REAL NOT NULL CHECK (price >= 0),
      quantity INTEGER DEFAULT 1 CHECK (quantity >= 1),
      teethNumbers TEXT DEFAULT '[]',
      subtotal REAL DEFAULT 0 CHECK (subtotal >= 0),
      deletedAt TEXT,
      FOREIGN KEY (chargeId) REFERENCES Charge(id) ON DELETE CASCADE,
      FOREIGN KEY (treatmentId) REFERENCES Treatment(id),
      FOREIGN KEY (inventoryItemId) REFERENCES InventoryItem(id)
    );

    CREATE TABLE IF NOT EXISTS Prescription (
      id TEXT PRIMARY KEY,
      patientId TEXT NOT NULL,
      visitId TEXT,
      doctorId TEXT NOT NULL,
      remark TEXT,
      createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
      updatedAt TEXT DEFAULT CURRENT_TIMESTAMP,
      deletedAt TEXT,
      FOREIGN KEY (patientId) REFERENCES Patient(id),
      FOREIGN KEY (visitId) REFERENCES Visit(id),
      FOREIGN KEY (doctorId) REFERENCES User(id)
    );

    CREATE TABLE IF NOT EXISTS PrescriptionItem (
      id TEXT PRIMARY KEY,
      prescriptionId TEXT NOT NULL,
      drugCode TEXT,
      drugName TEXT NOT NULL,
      spec TEXT NOT NULL,
      dosage TEXT NOT NULL,
      frequency TEXT NOT NULL,
      days INTEGER NOT NULL CHECK (days >= 1),
      quantity REAL NOT NULL CHECK (quantity >= 0),
      unit TEXT NOT NULL,
      deletedAt TEXT,
      FOREIGN KEY (prescriptionId) REFERENCES Prescription(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS TreatmentPlan (
      id TEXT PRIMARY KEY,
      patientId TEXT NOT NULL,
      visitId TEXT,
      doctorId TEXT NOT NULL,
      name TEXT NOT NULL,
      status TEXT DEFAULT 'DRAFT',
      totalFee REAL DEFAULT 0 CHECK (totalFee >= 0),
      remark TEXT,
      createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
      updatedAt TEXT DEFAULT CURRENT_TIMESTAMP,
      deletedAt TEXT,
      FOREIGN KEY (patientId) REFERENCES Patient(id),
      FOREIGN KEY (visitId) REFERENCES Visit(id),
      FOREIGN KEY (doctorId) REFERENCES User(id)
    );

    CREATE TABLE IF NOT EXISTS TreatmentPlanItem (
      id TEXT PRIMARY KEY,
      planId TEXT NOT NULL,
      code TEXT NOT NULL,
      name TEXT NOT NULL,
      category TEXT NOT NULL,
      price REAL NOT NULL CHECK (price >= 0),
      quantity INTEGER DEFAULT 1 CHECK (quantity >= 1),
      teethNumbers TEXT DEFAULT '[]',
      status TEXT DEFAULT 'PLANNED',
      treatmentId TEXT,
      completedAt TEXT,
      remark TEXT,
      updatedAt TEXT,
      deletedAt TEXT,
      FOREIGN KEY (planId) REFERENCES TreatmentPlan(id) ON DELETE CASCADE,
      FOREIGN KEY (treatmentId) REFERENCES Treatment(id)
    );

    CREATE TABLE IF NOT EXISTS DrugCatalog (
      id TEXT PRIMARY KEY,
      code TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      spec TEXT NOT NULL,
      category TEXT NOT NULL,
      price REAL NOT NULL CHECK (price >= 0),
      unit TEXT NOT NULL,
      stock REAL DEFAULT 0 CHECK (stock >= 0),
      remark TEXT,
      createdAt TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS Imaging (
      id TEXT PRIMARY KEY,
      patientId TEXT NOT NULL,
      visitId TEXT,
      doctorId TEXT,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      imageUrl TEXT NOT NULL,
      thumbnailUrl TEXT,
      takenAt TEXT DEFAULT CURRENT_TIMESTAMP,
      remark TEXT,
      createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
      updatedAt TEXT DEFAULT CURRENT_TIMESTAMP,
      deletedAt TEXT,
      FOREIGN KEY (patientId) REFERENCES Patient(id),
      FOREIGN KEY (visitId) REFERENCES Visit(id),
      FOREIGN KEY (doctorId) REFERENCES User(id)
    );

    CREATE TABLE IF NOT EXISTS ClinicInfo (
      id TEXT PRIMARY KEY,
      key TEXT UNIQUE NOT NULL,
      value TEXT,
      updatedAt TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS OperationLog (
      id TEXT PRIMARY KEY,
      userId TEXT,
      userName TEXT,
      action TEXT NOT NULL,
      target TEXT,
      detail TEXT,
      ip TEXT,
      createdAt TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      appliedAt TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS AuditLog (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      targetId TEXT NOT NULL,
      targetType TEXT NOT NULL,
      operatorId TEXT,
      operatorName TEXT,
      amount REAL,
      beforeData TEXT,
      afterData TEXT,
      remark TEXT,
      ip TEXT,
      createdAt TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS MemberCard (
      id TEXT PRIMARY KEY,
      patientId TEXT NOT NULL,
      cardNo TEXT UNIQUE NOT NULL,
      balance REAL DEFAULT 0 CHECK (balance >= 0),
      totalRecharge REAL DEFAULT 0 CHECK (totalRecharge >= 0),
      totalConsume REAL DEFAULT 0 CHECK (totalConsume >= 0),
      points REAL DEFAULT 0,
      totalPoints REAL DEFAULT 0,
      level TEXT DEFAULT 'NORMAL',
      status TEXT DEFAULT 'ACTIVE',
      createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
      updatedAt TEXT DEFAULT CURRENT_TIMESTAMP,
      deletedAt TEXT,
      FOREIGN KEY (patientId) REFERENCES Patient(id)
    );

    CREATE TABLE IF NOT EXISTS MemberCardLog (
      id TEXT PRIMARY KEY,
      cardId TEXT NOT NULL,
      type TEXT NOT NULL,
      amount REAL NOT NULL,
      balanceAfter REAL,
      chargeId TEXT,
      remark TEXT,
      createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (cardId) REFERENCES MemberCard(id) ON DELETE CASCADE,
      FOREIGN KEY (chargeId) REFERENCES Charge(id)
    );

    CREATE TABLE IF NOT EXISTS MemberPointLog (
      id TEXT PRIMARY KEY,
      cardId TEXT NOT NULL,
      type TEXT NOT NULL,
      points REAL NOT NULL,
      balanceAfter REAL,
      chargeId TEXT,
      remark TEXT,
      createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (cardId) REFERENCES MemberCard(id) ON DELETE CASCADE,
      FOREIGN KEY (chargeId) REFERENCES Charge(id)
    );

    CREATE TABLE IF NOT EXISTS OralExamination (
      id TEXT PRIMARY KEY,
      patientId TEXT NOT NULL,
      visitId TEXT,
      doctorId TEXT,
      examDate TEXT NOT NULL,
      plaqueIndex TEXT,
      calculusIndex TEXT,
      bleedingIndex TEXT,
      caries TEXT DEFAULT '[]',
      looseTeeth TEXT DEFAULT '[]',
      percussionPain TEXT DEFAULT '[]',
      pulpVitality TEXT DEFAULT '[]',
      mucosa TEXT,
      tmj TEXT,
      remark TEXT,
      createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
      updatedAt TEXT DEFAULT CURRENT_TIMESTAMP,
      deletedAt TEXT,
      FOREIGN KEY (patientId) REFERENCES Patient(id),
      FOREIGN KEY (visitId) REFERENCES Visit(id),
      FOREIGN KEY (doctorId) REFERENCES User(id)
    );

    CREATE TABLE IF NOT EXISTS PeriodontalRecord (
      id TEXT PRIMARY KEY,
      patientId TEXT NOT NULL,
      visitId TEXT,
      doctorId TEXT,
      examDate TEXT NOT NULL,
      data TEXT NOT NULL DEFAULT '{}',
      remark TEXT,
      createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
      updatedAt TEXT DEFAULT CURRENT_TIMESTAMP,
      deletedAt TEXT,
      FOREIGN KEY (patientId) REFERENCES Patient(id),
      FOREIGN KEY (visitId) REFERENCES Visit(id),
      FOREIGN KEY (doctorId) REFERENCES User(id)
    );

    CREATE TABLE IF NOT EXISTS Supplier (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      contactPerson TEXT,
      phone TEXT,
      address TEXT,
      bankAccount TEXT,
      remark TEXT,
      createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
      updatedAt TEXT DEFAULT CURRENT_TIMESTAMP,
      deletedAt TEXT
    );

    CREATE TABLE IF NOT EXISTS InventoryItem (
      id TEXT PRIMARY KEY,
      code TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      spec TEXT,
      category TEXT NOT NULL,
      unit TEXT NOT NULL,
      stock REAL DEFAULT 0 CHECK (stock >= 0),
      minStock REAL DEFAULT 0 CHECK (minStock >= 0),
      price REAL DEFAULT 0,
      supplierId TEXT,
      expireDate TEXT,
      location TEXT,
      remark TEXT,
      createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
      updatedAt TEXT DEFAULT CURRENT_TIMESTAMP,
      deletedAt TEXT,
      FOREIGN KEY (supplierId) REFERENCES Supplier(id)
    );

    CREATE TABLE IF NOT EXISTS InventoryTransaction (
      id TEXT PRIMARY KEY,
      itemId TEXT NOT NULL,
      type TEXT NOT NULL,
      quantity REAL NOT NULL CHECK (quantity > 0),
      unitPrice REAL DEFAULT 0,
      totalAmount REAL DEFAULT 0,
      supplierId TEXT,
      purchaseOrderId TEXT,
      operatorId TEXT,
      operatorName TEXT,
      remark TEXT,
      createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (itemId) REFERENCES InventoryItem(id),
      FOREIGN KEY (supplierId) REFERENCES Supplier(id),
      FOREIGN KEY (operatorId) REFERENCES User(id)
    );

    CREATE TABLE IF NOT EXISTS PurchaseOrder (
      id TEXT PRIMARY KEY,
      number TEXT UNIQUE NOT NULL,
      supplierId TEXT NOT NULL,
      totalAmount REAL DEFAULT 0,
      status TEXT DEFAULT 'PENDING',
      operatorId TEXT,
      remark TEXT,
      createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
      updatedAt TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (supplierId) REFERENCES Supplier(id),
      FOREIGN KEY (operatorId) REFERENCES User(id)
    );

    CREATE TABLE IF NOT EXISTS PurchaseOrderItem (
      id TEXT PRIMARY KEY,
      orderId TEXT NOT NULL,
      itemId TEXT,
      name TEXT NOT NULL,
      spec TEXT,
      quantity REAL NOT NULL,
      unitPrice REAL NOT NULL,
      subtotal REAL DEFAULT 0,
      FOREIGN KEY (orderId) REFERENCES PurchaseOrder(id) ON DELETE CASCADE,
      FOREIGN KEY (itemId) REFERENCES InventoryItem(id)
    );

    CREATE TABLE IF NOT EXISTS Refund (
      id TEXT PRIMARY KEY,
      chargeId TEXT NOT NULL,
      patientId TEXT NOT NULL,
      amount REAL NOT NULL CHECK (amount > 0),
      reason TEXT,
      operatorId TEXT,
      operatorName TEXT,
      createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
      deletedAt TEXT,
      FOREIGN KEY (chargeId) REFERENCES Charge(id),
      FOREIGN KEY (patientId) REFERENCES Patient(id),
      FOREIGN KEY (operatorId) REFERENCES User(id)
    );

    CREATE TABLE IF NOT EXISTS WechatMessage (
      id TEXT PRIMARY KEY,
      patientId TEXT,
      patientName TEXT,
      openId TEXT,
      content TEXT NOT NULL,
      type TEXT NOT NULL,
      templateId TEXT,
      status TEXT DEFAULT 'PENDING',
      sentAt TEXT,
      remark TEXT,
      createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
      deletedAt TEXT,
      FOREIGN KEY (patientId) REFERENCES Patient(id)
    );

    CREATE TABLE IF NOT EXISTS Equipment (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      model TEXT,
      brand TEXT,
      serialNumber TEXT,
      category TEXT,
      location TEXT,
      purchasePrice REAL,
      purchaseDate TEXT,
      supplier TEXT,
      status TEXT DEFAULT 'NORMAL',
      remarks TEXT,
      createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
      updatedAt TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS BackupRecord (
      id TEXT PRIMARY KEY,
      filename TEXT NOT NULL,
      fileSize INTEGER,
      type TEXT DEFAULT 'MANUAL',
      operatorId TEXT,
      operatorName TEXT,
      remark TEXT,
      createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (operatorId) REFERENCES User(id)
    );

    CREATE TABLE IF NOT EXISTS Registration (
      id TEXT PRIMARY KEY,
      patientId TEXT NOT NULL,
      doctorId TEXT,
      type TEXT NOT NULL,
      status TEXT DEFAULT 'REGISTERED',
      visitId TEXT,
      appointmentId TEXT,
      triageNote TEXT,
      chiefComplaint TEXT,
      registeredBy TEXT,
      registeredAt TEXT DEFAULT CURRENT_TIMESTAMP,
      triagedAt TEXT,
      startedAt TEXT,
      completedAt TEXT,
      createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
      updatedAt TEXT DEFAULT CURRENT_TIMESTAMP,
      deletedAt TEXT,
      FOREIGN KEY (patientId) REFERENCES Patient(id),
      FOREIGN KEY (doctorId) REFERENCES User(id),
      FOREIGN KEY (visitId) REFERENCES Visit(id),
      FOREIGN KEY (appointmentId) REFERENCES Appointment(id)
    );

    CREATE TABLE IF NOT EXISTS MedicalRecord (
      id TEXT PRIMARY KEY,
      patientId TEXT NOT NULL,
      visitId TEXT,
      doctorId TEXT NOT NULL,
      templateId TEXT,
      chiefComplaint TEXT,
      presentIllness TEXT,
      pastHistory TEXT,
      allergyHistory TEXT,
      examination TEXT,
      diagnosis TEXT,
      treatmentPlan TEXT,
      teethInvolved TEXT DEFAULT '[]',
      images TEXT DEFAULT '[]',
      signature TEXT,
      isLocked INTEGER DEFAULT 0,
      lockedAt TEXT,
      lockedBy TEXT,
      modifyRequestId TEXT,
      createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
      updatedAt TEXT DEFAULT CURRENT_TIMESTAMP,
      deletedAt TEXT,
      FOREIGN KEY (patientId) REFERENCES Patient(id),
      FOREIGN KEY (visitId) REFERENCES Visit(id),
      FOREIGN KEY (doctorId) REFERENCES User(id)
    );

    CREATE TABLE IF NOT EXISTS MedicalRecordTemplate (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      category TEXT,
      chiefComplaint TEXT,
      presentIllness TEXT,
      pastHistory TEXT,
      examination TEXT,
      diagnosis TEXT,
      treatmentPlan TEXT,
      isPublic INTEGER DEFAULT 1,
      creatorId TEXT,
      createdAt TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS MedicalRecordPhrase (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      category TEXT,
      content TEXT NOT NULL,
      isPublic INTEGER DEFAULT 1,
      creatorId TEXT,
      createdAt TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS RecordModifyRequest (
      id TEXT PRIMARY KEY,
      recordId TEXT NOT NULL,
      applicantId TEXT NOT NULL,
      reason TEXT NOT NULL,
      status TEXT DEFAULT 'PENDING',
      reviewerId TEXT,
      reviewRemark TEXT,
      reviewedAt TEXT,
      createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (recordId) REFERENCES MedicalRecord(id),
      FOREIGN KEY (applicantId) REFERENCES User(id),
      FOREIGN KEY (reviewerId) REFERENCES User(id)
    );

    CREATE TABLE IF NOT EXISTS FollowUpTemplate (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT,
      daysAfter INTEGER DEFAULT 1,
      content TEXT,
      assigneeId TEXT,
      isEnabled INTEGER DEFAULT 1,
      createdAt TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS FollowUpItem (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      category TEXT,
      templateId TEXT,
      sortOrder INTEGER DEFAULT 0,
      createdAt TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS FollowUpResult (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      category TEXT,
      sortOrder INTEGER DEFAULT 0,
      createdAt TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS AutoFollowUpRule (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      triggerType TEXT,
      triggerDays INTEGER DEFAULT 1,
      templateId TEXT,
      assigneeId TEXT,
      isEnabled INTEGER DEFAULT 1,
      createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (templateId) REFERENCES FollowUpTemplate(id)
    );

    CREATE TABLE IF NOT EXISTS ProcessingFactory (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      contactPerson TEXT,
      phone TEXT,
      address TEXT,
      remark TEXT,
      status TEXT DEFAULT 'ACTIVE',
      createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
      updatedAt TEXT DEFAULT CURRENT_TIMESTAMP,
      deletedAt TEXT
    );

    CREATE TABLE IF NOT EXISTS ProcessingProduct (
      id TEXT PRIMARY KEY,
      factoryId TEXT NOT NULL,
      name TEXT NOT NULL,
      category TEXT,
      price REAL DEFAULT 0,
      remark TEXT,
      createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (factoryId) REFERENCES ProcessingFactory(id)
    );

    CREATE TABLE IF NOT EXISTS ProcessingOrder (
      id TEXT PRIMARY KEY,
      number TEXT UNIQUE NOT NULL,
      patientId TEXT NOT NULL,
      visitId TEXT,
      factoryId TEXT NOT NULL,
      doctorId TEXT,
      shade TEXT,
      teethNumbers TEXT DEFAULT '[]',
      totalFee REAL DEFAULT 0,
      status TEXT DEFAULT 'SENT',
      chargeId TEXT,
      sentAt TEXT,
      expectedAt TEXT,
      receivedAt TEXT,
      deliveredAt TEXT,
      remark TEXT,
      creatorId TEXT,
      createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
      updatedAt TEXT DEFAULT CURRENT_TIMESTAMP,
      deletedAt TEXT,
      FOREIGN KEY (patientId) REFERENCES Patient(id),
      FOREIGN KEY (visitId) REFERENCES Visit(id),
      FOREIGN KEY (factoryId) REFERENCES ProcessingFactory(id),
      FOREIGN KEY (doctorId) REFERENCES User(id),
      FOREIGN KEY (chargeId) REFERENCES Charge(id)
    );

    CREATE TABLE IF NOT EXISTS ProcessingOrderItem (
      id TEXT PRIMARY KEY,
      orderId TEXT NOT NULL,
      productId TEXT,
      productName TEXT NOT NULL,
      toothNumber INTEGER,
      quantity INTEGER DEFAULT 1,
      unitPrice REAL DEFAULT 0,
      subtotal REAL DEFAULT 0,
      remark TEXT,
      FOREIGN KEY (orderId) REFERENCES ProcessingOrder(id) ON DELETE CASCADE,
      FOREIGN KEY (productId) REFERENCES ProcessingProduct(id)
    );

    CREATE TABLE IF NOT EXISTS ProcessingFlowLog (
      id TEXT PRIMARY KEY,
      orderId TEXT NOT NULL,
      status TEXT NOT NULL,
      remark TEXT,
      operatorId TEXT,
      createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (orderId) REFERENCES ProcessingOrder(id)
    );

    CREATE TABLE IF NOT EXISTS ChargeCombo (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      category TEXT,
      isPublic INTEGER DEFAULT 1,
      creatorId TEXT,
      createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
      deletedAt TEXT
    );

    CREATE TABLE IF NOT EXISTS ChargeComboItem (
      id TEXT PRIMARY KEY,
      comboId TEXT NOT NULL,
      treatmentCatalogId TEXT,
      itemName TEXT NOT NULL,
      price REAL DEFAULT 0,
      quantity INTEGER DEFAULT 1,
      deletedAt TEXT,
      FOREIGN KEY (comboId) REFERENCES ChargeCombo(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS PaymentMethod (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      code TEXT UNIQUE NOT NULL,
      parentId TEXT,
      sortOrder INTEGER DEFAULT 0,
      isEnabled INTEGER DEFAULT 1,
      createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
      deletedAt TEXT
    );

    CREATE TABLE IF NOT EXISTS DebtRecord (
      id TEXT PRIMARY KEY,
      chargeId TEXT NOT NULL,
      patientId TEXT NOT NULL,
      totalAmount REAL NOT NULL,
      paidAmount REAL DEFAULT 0,
      debtAmount REAL NOT NULL,
      status TEXT DEFAULT 'UNPAID',
      lastPaymentAt TEXT,
      remark TEXT,
      createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
      updatedAt TEXT DEFAULT CURRENT_TIMESTAMP,
      deletedAt TEXT,
      FOREIGN KEY (chargeId) REFERENCES Charge(id),
      FOREIGN KEY (patientId) REFERENCES Patient(id)
    );

    CREATE TABLE IF NOT EXISTS FirstExam (
      id TEXT PRIMARY KEY,
      patientId TEXT NOT NULL,
      doctorId TEXT,
      consultantId TEXT,
      examDate TEXT DEFAULT CURRENT_TIMESTAMP,
      dentitionType TEXT DEFAULT 'PERMANENT',
      chiefComplaint TEXT,
      diagnosis TEXT,
      treatmentSuggestion TEXT,
      remark TEXT,
      isRestart INTEGER DEFAULT 0,
      parentExamId TEXT,
      status TEXT DEFAULT 'DRAFT',
      createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
      updatedAt TEXT DEFAULT CURRENT_TIMESTAMP,
      deletedAt TEXT,
      FOREIGN KEY (patientId) REFERENCES Patient(id),
      FOREIGN KEY (doctorId) REFERENCES User(id),
      FOREIGN KEY (consultantId) REFERENCES User(id)
    );

    CREATE TABLE IF NOT EXISTS FirstExamTooth (
      id TEXT PRIMARY KEY,
      examId TEXT NOT NULL,
      toothNumber INTEGER NOT NULL,
      toothStatus TEXT DEFAULT 'SOUND',
      diseases TEXT DEFAULT '[]',
      isChief INTEGER DEFAULT 0,
      treatmentPlan TEXT,
      remark TEXT,
      FOREIGN KEY (examId) REFERENCES FirstExam(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS FirstExamTrack (
      id TEXT PRIMARY KEY,
      examId TEXT NOT NULL,
      patientId TEXT NOT NULL,
      doctorId TEXT,
      status TEXT DEFAULT 'PENDING',
      leaderSuggestion TEXT,
      directorSuggestion TEXT,
      churnReason TEXT,
      churnSolution TEXT,
      createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
      updatedAt TEXT DEFAULT CURRENT_TIMESTAMP,
      deletedAt TEXT,
      FOREIGN KEY (examId) REFERENCES FirstExam(id),
      FOREIGN KEY (patientId) REFERENCES Patient(id),
      FOREIGN KEY (doctorId) REFERENCES User(id)
    );

    CREATE TABLE IF NOT EXISTS FirstExamFollowUp (
      id TEXT PRIMARY KEY,
      examId TEXT NOT NULL,
      planDate TEXT,
      content TEXT,
      assigneeId TEXT,
      createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (examId) REFERENCES FirstExam(id) ON DELETE CASCADE,
      FOREIGN KEY (assigneeId) REFERENCES User(id)
    );

    CREATE TABLE IF NOT EXISTS IdempotencyRecord (
      id TEXT PRIMARY KEY,
      key TEXT UNIQUE NOT NULL,
      type TEXT NOT NULL,
      status TEXT DEFAULT 'PROCESSING',
      result TEXT,
      createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
      expiresAt TEXT NOT NULL
    );
  `);

  createIndexes();
};

function createIndexes() {
  createIndexIfNotExists('idx_clinic_code', 'Clinic', 'code');
  createIndexIfNotExists('idx_clinic_active', 'Clinic', 'isActive');
  createIndexIfNotExists('idx_user_clinic', 'User', 'clinicId');
  createIndexIfNotExists('idx_patient_clinic', 'Patient', 'clinicId');
  createIndexIfNotExists('idx_used_refresh_token_user', 'UsedRefreshToken', 'userId');
  createIndexIfNotExists('idx_patient_name', 'Patient', 'name');
  createIndexIfNotExists('idx_patient_phone', 'Patient', 'phone');
  createIndexIfNotExists('idx_patient_code', 'Patient', 'code');
  createIndexIfNotExists('idx_patient_source', 'Patient', 'source');
  createIndexIfNotExists('idx_appointment_doctor', 'Appointment', 'doctorId');
  createIndexIfNotExists('idx_appointment_patient', 'Appointment', 'patientId');
  createIndexIfNotExists('idx_appointment_start_time', 'Appointment', 'startTime');
  createIndexIfNotExists('idx_appointment_status', 'Appointment', 'status');
  createIndexIfNotExists('idx_visit_patient', 'Visit', 'patientId');
  createIndexIfNotExists('idx_visit_doctor', 'Visit', 'doctorId');
  createIndexIfNotExists('idx_visit_status', 'Visit', 'status');
  createIndexIfNotExists('idx_treatment_patient', 'Treatment', 'patientId');
  createIndexIfNotExists('idx_treatment_visit', 'Treatment', 'visitId');
  createIndexIfNotExists('idx_treatment_status', 'Treatment', 'status');
  createIndexIfNotExists('idx_charge_patient', 'Charge', 'patientId');
  createIndexIfNotExists('idx_charge_status', 'Charge', 'status');
  createIndexIfNotExists('idx_charge_visit', 'Charge', 'visitId');
  createIndexIfNotExists('idx_prescription_patient', 'Prescription', 'patientId');
  createIndexIfNotExists('idx_prescription_visit', 'Prescription', 'visitId');
  createIndexIfNotExists('idx_imaging_patient', 'Imaging', 'patientId');
  createIndexIfNotExists('idx_imaging_visit', 'Imaging', 'visitId');
  createIndexIfNotExists('idx_followup_patient', 'FollowUp', 'patientId');
  createIndexIfNotExists('idx_followup_status', 'FollowUp', 'status');
  createIndexIfNotExists('idx_followup_plan_date', 'FollowUp', 'planDate');
  createIndexIfNotExists('idx_member_card_patient', 'MemberCard', 'patientId');
  createIndexIfNotExists('idx_member_card_status', 'MemberCard', 'status');
  createIndexIfNotExists('idx_inventory_item_code', 'InventoryItem', 'code');
  createIndexIfNotExists('idx_inventory_item_category', 'InventoryItem', 'category');
  createIndexIfNotExists('idx_inventory_item_supplier', 'InventoryItem', 'supplierId');
  createIndexIfNotExists('idx_supplier_name', 'Supplier', 'name');
  createIndexIfNotExists('idx_equipment_name', 'Equipment', 'name');
  createIndexIfNotExists('idx_equipment_category', 'Equipment', 'category');
  createIndexIfNotExists('idx_equipment_status', 'Equipment', 'status');
  createIndexIfNotExists('idx_registration_patient', 'Registration', 'patientId');
  createIndexIfNotExists('idx_registration_status', 'Registration', 'status');
  createIndexIfNotExists('idx_medical_record_patient', 'MedicalRecord', 'patientId');
  createIndexIfNotExists('idx_medical_record_visit', 'MedicalRecord', 'visitId');
  createIndexIfNotExists('idx_tooth_record_patient', 'ToothRecord', 'patientId');
  createIndexIfNotExists('idx_purchase_order_supplier', 'PurchaseOrder', 'supplierId');
  createIndexIfNotExists('idx_purchase_order_status', 'PurchaseOrder', 'status');
  createIndexIfNotExists('idx_processing_order_patient', 'ProcessingOrder', 'patientId');
  createIndexIfNotExists('idx_processing_order_factory', 'ProcessingOrder', 'factoryId');
  createIndexIfNotExists('idx_processing_order_status', 'ProcessingOrder', 'status');
  createIndexIfNotExists('idx_user_username', 'User', 'username');
  createIndexIfNotExists('idx_user_role', 'User', 'role');
  createIndexIfNotExists('idx_operation_log_user', 'OperationLog', 'userId');
  createIndexIfNotExists('idx_operation_log_created', 'OperationLog', 'createdAt');
  createIndexIfNotExists('idx_chair_active', 'Chair', 'active');
  createIndexIfNotExists('idx_first_exam_patient', 'FirstExam', 'patientId');
  createIndexIfNotExists('idx_first_exam_status', 'FirstExam', 'status');
  createIndexIfNotExists('idx_oral_exam_patient', 'OralExamination', 'patientId');
  createIndexIfNotExists('idx_periodontal_patient', 'PeriodontalRecord', 'patientId');
  createIndexIfNotExists('idx_treatment_plan_patient', 'TreatmentPlan', 'patientId');
  createIndexIfNotExists('idx_treatment_plan_status', 'TreatmentPlan', 'status');
  createIndexIfNotExists('idx_charge_item_order', 'ChargeItem', 'chargeId');
  createIndexIfNotExists('idx_treatment_plan_item_plan', 'TreatmentPlanItem', 'planId');
  createIndexIfNotExists('idx_prescription_item_prescription', 'PrescriptionItem', 'prescriptionId');
  createIndexIfNotExists('idx_purchase_order_item_order', 'PurchaseOrderItem', 'orderId');
  createIndexIfNotExists('idx_processing_order_item_order', 'ProcessingOrderItem', 'orderId');
  createIndexIfNotExists('idx_processing_flow_log_order', 'ProcessingFlowLog', 'orderId');
  createIndexIfNotExists('idx_member_card_log_card', 'MemberCardLog', 'cardId');
  createIndexIfNotExists('idx_inventory_transaction_item', 'InventoryTransaction', 'itemId');
  createIndexIfNotExists('idx_wechat_message_patient', 'WechatMessage', 'patientId');
  createIndexIfNotExists('idx_refund_charge', 'Refund', 'chargeId');
  createIndexIfNotExists('idx_debt_patient', 'DebtRecord', 'patientId');
  createIndexIfNotExists('idx_debt_status', 'DebtRecord', 'status');
  createIndexIfNotExists('idx_debt_charge', 'DebtRecord', 'chargeId');
  createIndexIfNotExists('idx_debt_created', 'DebtRecord', 'createdAt');
  // P0.4: DebtRecord.chargeId 唯一索引（防止同一收费单产生重复欠费记录）
  try {
    db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_debt_charge_unique ON DebtRecord(chargeId)');
  } catch (_err) {
    // 忽略：可能存在历史重复数据
  }
  createIndexIfNotExists('idx_idempotency_key', 'IdempotencyRecord', 'key');
  createIndexIfNotExists('idx_idempotency_expires', 'IdempotencyRecord', 'expiresAt');

  createIndexIfNotExists('idx_appointment_doctor_start', 'Appointment', 'doctorId, startTime');
  createIndexIfNotExists('idx_appointment_start_status', 'Appointment', 'startTime, status');
  createIndexIfNotExists('idx_charge_paid_at_status', 'Charge', 'paidAt, status');
  createIndexIfNotExists('idx_charge_doctor_paid', 'Charge', 'doctorId, paidAt');
  createIndexIfNotExists('idx_treatment_doctor_completed', 'Treatment', 'doctorId, completedDate');
  createIndexIfNotExists('idx_patient_created', 'Patient', 'createdAt');
  createIndexIfNotExists('idx_visit_doctor_start', 'Visit', 'doctorId, startTime');

  createIndexIfNotExists('idx_member_card_status_balance', 'MemberCard', 'status, balance');
  createIndexIfNotExists('idx_registration_doctor_status', 'Registration', 'doctorId, status');
  createIndexIfNotExists('idx_registration_status_registered', 'Registration', 'status, registeredAt');
  createIndexIfNotExists('idx_medical_record_doctor_created', 'MedicalRecord', 'doctorId, createdAt');
  createIndexIfNotExists('idx_first_exam_doctor_date', 'FirstExam', 'doctorId, examDate');
  createIndexIfNotExists('idx_followup_status_date', 'FollowUp', 'status, planDate');
}
