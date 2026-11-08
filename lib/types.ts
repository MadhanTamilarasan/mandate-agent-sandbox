export type Decision = "allow" | "escalate" | "block";

export type MandateStatus = "pending_funding" | "active" | "closed" | "expired";

/** The user-editable terms of a mandate. These (and only these) are signed. */
export type MandateTerms = {
  name: string;
  goal: string; // natural-language brief the auditor checks purchases against
  currency: "USD";
  budget: number; // total the agent may ever spend
  maxPerItem: number; // hard cap for a single purchase
  autoApproveBelow: number; // purchases above this need a human click
  blockedTerms: string[]; // keywords that must never appear in a purchase
  allowedMerchants: string[]; // empty = any merchant
  expiresAt: string; // ISO timestamp
};

export type Mandate = MandateTerms & {
  id: string;
  createdAt: string;
  status: MandateStatus;
  signature: string; // HMAC over the canonical terms + id
  spent: number;
  reserved: number; // held back for active limit orders
  tamperedFrom?: number; // demo control: original budget before a simulated tamper
  paypal: {
    orderId?: string;
    approveUrl?: string;
    authorizationId?: string;
    fundedAmount?: number;
    payerEmail?: string;
  };
};

export type ProductSnapshot = {
  id: string;
  title: string;
  brand: string;
  description: string;
  imageUrl: string | null;
  merchant: string; // offer domain
  buyUrl: string;
  price: number;
  currency: string;
  inStock: boolean;
};

export type RuleCheck = { rule: string; ok: boolean; message: string };

export type AuditorVerdict = {
  verdict: Decision;
  fitScore: number; // 0-100: how well the product matches the mandate goal
  injectionSuspected: boolean;
  reasons: string[];
  unavailable?: boolean; // auditor LLM could not be reached (decision escalates to a human)
};

export type PurchaseVia = "agent" | "limit_order" | "human_approval";

export type Purchase = {
  id: string;
  mandateId: string;
  product: ProductSnapshot;
  amount: number;
  via: PurchaseVia;
  captureId?: string;
  status: "captured" | "failed" | "refunded";
  error?: string;
  createdAt: string;
};

export type Approval = {
  id: string;
  mandateId: string;
  product: ProductSnapshot;
  reasons: string[];
  checks: RuleCheck[];
  auditor?: AuditorVerdict;
  via: PurchaseVia;
  limitOrderId?: string;
  status: "pending" | "approved" | "rejected";
  createdAt: string;
  resolvedAt?: string;
};

export type LimitOrder = {
  id: string;
  mandateId: string;
  product: ProductSnapshot;
  targetPrice: number;
  currentPrice: number;
  demoPriceOverride?: number; // demo control: simulate a price drop
  status: "watching" | "purchased" | "blocked" | "escalated" | "cancelled" | "expired";
  statusNote?: string;
  lastCheckedAt?: string;
  createdAt: string;
  expiresAt: string;
};

export type AuditEvent = {
  id: string;
  mandateId: string;
  at: string;
  actor: "user" | "agent" | "rules" | "auditor" | "paypal" | "system";
  kind: string;
  decision?: Decision;
  summary: string;
  details?: unknown;
};

export type Store = {
  signingSecret: string;
  mandates: Mandate[];
  purchases: Purchase[];
  approvals: Approval[];
  limitOrders: LimitOrder[];
  events: AuditEvent[];
};
