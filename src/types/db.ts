export type Role = 'admin' | 'driver';

export type BusinessType = 'sole_proprietor' | 'corporation' | 'corporation_owner' | 'employee';

export const businessTypeLabels: Record<BusinessType, string> = {
  sole_proprietor: '個人事業主',
  corporation: '法人',
  corporation_owner: '法人オーナー',
  employee: '社員',
};

export interface Profile {
  id: string;
  full_name: string;
  role: Role;
  deduction_rate: number | null;
  office_id: string | null;
  active: boolean;
  business_type: BusinessType | null;
  company_name: string | null;
  must_change_password: boolean;
  created_at: string;
}

export interface Office {
  id: string;
  name: string;
  sort_order: number;
  active: boolean;
  created_at: string;
}

export interface SizeCategory {
  id: string;
  name: string;
  unit_price: number;
  sort_order: number;
  active: boolean;
  created_at: string;
}

export interface Course {
  id: string;
  name: string;
  office_id: string;
  daily_vehicle_fee: number;
  sort_order: number;
  active: boolean;
  area_geojson: GeoJSON.FeatureCollection | null;
  created_at: string;
}

export interface ShiftAssignment {
  id: string;
  work_date: string;
  driver_id: string;
  course_id: string;
  note: string | null;
  created_at: string;
}

export interface DeliveryRecord {
  id: string;
  work_date: string;
  driver_id: string;
  course_id: string;
  size_category_id: string;
  quantity: number;
  created_at: string;
}

export interface PagePermission {
  page_key: string;
  label: string;
  sort_order: number;
  admin_visible: boolean;
  driver_visible: boolean;
}

export interface VehicleDay {
  id: string;
  month: number;
  day: number;
  amount: number;
  note: string | null;
  active: boolean;
  created_at: string;
}

export interface DriverDeductionRate {
  id: string;
  driver_id: string;
  effective_from: string; // YYYY-MM-DD
  deduction_rate: number;
  note: string | null;
  created_at: string;
}

// 曜日区分コード (固定 + カスタム)。DB の day_types マスタを正とする。
export type DayType = string;

export const SYSTEM_DAY_TYPES = ['weekday', 'saturday', 'sunday', 'holiday'] as const;

export interface DayTypeDef {
  code: string;
  label: string;
  sort_order: number;
  is_system: boolean;
  created_at: string;
}

export interface SpecialDate {
  date: string; // YYYY-MM-DD
  day_type_code: string;
  note: string | null;
  created_at: string;
}

export interface OfficeDayCourse {
  office_id: string;
  day_type: DayType;
  course_id: string;
  created_at: string;
}

export interface ShiftPattern {
  id: string;
  driver_id: string;
  day_of_week: number; // 0=日 ... 6=土
  course_id: string;
  created_at: string;
}

export interface WorkItem {
  id: string;
  name: string;
  amount: number;
  sort_order: number;
  active: boolean;
  created_at: string;
}

export interface Incident {
  id: string;
  occurred_at: string; // YYYY-MM-DD
  reporter_name: string;
  category: string | null;
  content: string;
  cause: string | null;
  countermeasure: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface WorkRecord {
  id: string;
  work_date: string;
  driver_id: string;
  work_item_id: string;
  note: string | null;
  created_at: string;
}

export type PayeeTaxStatus = 'taxable' | 'exempt';

export interface ExpenseRecord {
  id: string;
  payment_date: string;
  driver_id: string | null;
  office_id: string | null;
  description: string;
  payee_name: string;
  payee_tax_status: PayeeTaxStatus;
  invoice_registration_no: string | null;
  tax_rate: number;
  amount_incl_tax: number;
  note: string | null;
  created_at: string;
}
