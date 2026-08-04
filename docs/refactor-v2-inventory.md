# Refactor V2 - Functional Inventory

This document is derived from the legacy application only as a feature checklist. It is not an implementation plan for reusing the old code.

## 1. Identity and Access

- User login with password and refresh-token flow.
- Role-based authorization: BOSS, ADMIN, DOCTOR, RECEPTIONIST, NURSE, TECHNICIAN.
- Current-user profile, password change, token invalidation.
- Login lockout and login-attempt tracking.

## 2. Patient Lifecycle

- Patient CRUD, search, paging, soft delete.
- Patient profile fields: gender, birthday, phone, ID card, address, occupation, tags, allergies, medication history, systemic diseases, family members.
- Patient risk score calculation and history.
- Patient consent/form and first exam flow.

## 3. Scheduling and Visit Flow

- Appointment CRUD with doctor/chair conflict detection.
- Appointment status machine: BOOKED, ARRIVED, IN_CHAIR, COMPLETED, CANCELLED, NO_SHOW.
- Chair management and active state.
- Registration/triage flow and registration status.
- Visit creation from appointment or registration, visit lifecycle, chief complaint, diagnosis, treatment plan, summary.

## 4. Clinical Records

- Oral examination records.
- Periodontal records with tooth-level probe/mobility data.
- First exams, first-exam tooth records, status transitions, and track tab.
- Electronic medical records with templates, phrases, lock state, signature, and modify requests.
- Tooth records with per-tooth status and conditions.
- Imaging records and thumbnail/image URLs.
- Cephalometric analysis with landmarks, angles, metrics, templates, and reports.
- Treatment catalog, treatment plan, plan items, treatment records, and progress snapshots.

## 5. Prescriptions and Pharmacy Content

- Prescription CRUD with items.
- Prescription safety validation against allergies/interactions.
- Drug catalog and medical phrases.

## 6. Financial Workflow

- Charge creation with line items, discounts, partial payment, full payment, refunds.
- Charge status machine: UNPAID, PARTIAL, PAID, REFUNDED, CANCELLED.
- Payment methods: cash, WeChat, Alipay, bank card, debt, member card, union pay, insurance, other.
- Debt records and debt payment.
- Member cards with recharge, consume, points, balance logs, levels.
- Refund validation, idempotency keys, debt/member-card rollback.
- Charge assistant and price list.

## 7. Inventory and Supply Chain

- Inventory items with stock, min stock, category, unit, price, expiry, supplier.
- Inventory transactions: IN, OUT, ADJUST with stock invariants.
- Suppliers, purchase orders, purchase order items, receiving workflow.
- Processing orders and factories, status transitions, processing products/flows.
- Replenishment suggestions with consumption analytics, ROP/EOQ, apply-to-PO flow.
- Low-stock warnings and expiry warnings.

## 8. Communication and Follow-up

- Follow-up tasks, assignment, completion, reminders, 90-day batch generation.
- Follow-up templates, trigger rules, risk multipliers, adherence scoring.
- WeChat messages, templates, send status, bulk send.
- Satisfaction surveys, NPS, doctor rankings, trends.

## 9. HR, Staff, and Equipment

- Staff/user management and role assignment.
- Work schedules, attendance, leave requests.
- Equipment catalog, status: NORMAL, MAINTENANCE, BROKEN, SCRAPPED.

## 10. Analytics and Business Alerts

- Dashboard stats: today appointments/visits/patients/charges, finance, recent patients, recent appointments, recent charges, todos.
- Revenue, patient growth, member stats, inventory stats.
- Customer insights/RFM, churn prediction, satisfaction NPS.
- Doctor performance anomalies.
- Business alerts and scheduled task failure alerts.

## 11. System and Desktop Operations

- Clinic management and multi-clinic context.
- System settings with type-safe keys and defaults.
- Operation logs with paging/filtering.
- Search across patients and business records with phone masking.
- Manual/automatic encrypted backups, restore drill, integrity checks, cleanup.
- Bulk import from files with validation.
- Print templates, prescriptions, receipts, treatment plans, clinic reports, cephalometric reports.
- Health endpoint, metrics, request tracing, rate limiting, SQL injection middleware, CORS, Helmet.
- Electron desktop packaging: single instance, tray, auto-launch, API lifecycle, IPC allowlist.
- Offline sync API and change log cleanup.

## 12. Cross-cutting Requirements

- Soft delete across business entities.
- Parameterized SQL and SQL injection protection.
- Audit log for important business mutations.
- Idempotency keys for payments/recharges/refunds.
- Fixed clinic timezone `Asia/Shanghai`.
- Money stored as cents and converted at presentation boundaries.
- Trace IDs on every request and structured logging.
- Dependency and security audit.
