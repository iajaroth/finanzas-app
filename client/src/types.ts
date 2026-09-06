export type TxType = 'income' | 'expense' | 'transfer';

export interface Account {
  id: number;
  name: string;
  kind: 'bank' | 'cash' | 'credit_card' | 'wallet';
  bank: string;
  last4: string;
  currency: string;
  opening_balance: number;
  credit_limit: number;
  color: string;
  archived: number;
  balance: number;
  available: number | null;
}

export interface Category {
  id: number;
  name: string;
  kind: 'expense' | 'income';
  icon: string;
  color: string;
}

export interface Tx {
  id: number;
  account_id: number | null;
  transfer_to_id: number | null;
  category_id: number | null;
  type: TxType;
  amount: number;
  merchant: string;
  description: string;
  notes: string;
  occurred_at: string;
  source: string;
  account_name?: string | null;
  account_kind?: string | null;
  account_color?: string | null;
  transfer_to_name?: string | null;
  category_name?: string | null;
  category_icon?: string | null;
  category_color?: string | null;
}

export interface Summary {
  month: string;
  income: number;
  expense: number;
  net: number;
  total_balance: number;
  by_category: { category_id: number; name: string; icon: string; color: string; total: number }[];
  trend: { month: string; income: number; expense: number }[];
  recent: Tx[];
  budget: { amount: number; spent: number } | null;
  pending_imports: number;
}

export interface Stats {
  month: string;
  by_category: { category_id: number; name: string; icon: string; color: string; total: number; n: number }[];
  by_account: { account_id: number; name: string; kind: string; color: string; bank: string; total: number }[];
  top_merchants: { merchant: string; total: number; n: number }[];
  by_month: { month: string; income: number; expense: number }[];
}

export interface EmailImport {
  id: number;
  message_id: string;
  bank: string;
  from_email: string;
  subject: string;
  snippet: string;
  weblink: string;
  type: TxType | null;
  amount: number | null;
  merchant: string;
  occurred_at: string | null;
  category_id: number | null;
  account_id: number | null;
  confidence: number;
  status: 'pending' | 'approved' | 'rejected';
  received_at: string;
  category_name?: string | null;
  account_name?: string | null;
}

export interface EmailStatus {
  configured: boolean;
  connected: boolean;
  redirect_uri: string;
  client_id: string;
  has_secret: boolean;
  account_email: string;
  connected_at: string | null;
  last_sync_at: string;
  auto_approve: boolean;
  sync_days: number;
  sender_filters: string;
  pending: number;
  syncing?: boolean;
  sync_started_at?: string | null;
  sync_processed?: number;
  sync_total?: number;
  last_sync_result?: { scanned: number; created: number; pending: number; skipped: number } | null;
  last_sync_error?: string | null;
}

export interface Settings {
  currency: string;
  monthly_budget: number;
  auto_approve: boolean;
  sender_filters: string;
  sync_days: number;
  last_sync_at: string;
  azure: { client_id: string; has_secret: boolean; redirect_uri: string; configured: boolean };
}
