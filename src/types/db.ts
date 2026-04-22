export type Role = 'admin' | 'driver';

export interface Profile {
  id: string;
  full_name: string;
  role: Role;
  commission_rate: number | null;
  office_id: string | null;
  active: boolean;
  created_at: string;
}

export interface Office {
  id: string;
  name: string;
  active: boolean;
}

export interface SizeCategory {
  id: string;
  name: string;
  unit_price: number;
  sort_order: number;
  active: boolean;
}

export interface Course {
  id: string;
  name: string;
  office_id: string;
  daily_vehicle_fee: number;
  active: boolean;
}

export interface ShiftAssignment {
  id: string;
  work_date: string;
  driver_id: string;
  course_id: string;
  note: string | null;
}

export interface DeliveryRecord {
  id: string;
  work_date: string;
  driver_id: string;
  course_id: string;
  size_category_id: string;
  quantity: number;
}

export interface ExpenseRecord {
  id: string;
  payment_date: string;
  driver_id: string | null;
  description: string;
  payee_name: string;
  payee_tax_status: 'taxable' | 'exempt';
  invoice_registration_no: string | null;
  tax_rate: number;
  amount_incl_tax: number;
  note: string | null;
}
