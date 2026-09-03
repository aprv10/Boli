export type HardConstraint =
  | 'vegan'
  | 'plastic-free'
  | 'branded'
  | 'multi-city';

export type CatalogProduct = {
  id: string;
  sku: string;
  name: string;
  category: string;
  tags: string[];
  unitPricePaise: number;
  unitCostPaise: number;
  availableQuantity: number;
  leadTimeDays: number;
};

export type QuoteRequest = {
  selection?: { mode: 'kit' | 'product'; query: string };
  quantity: number;
  maxUnitPaise: number;
  deliveryLocations: string[];
  deadline: string;
  hardConstraints: HardConstraint[];
  minimumMarginBps?: number;
  now?: string;
};

export type QuoteLine = {
  code: string;
  label: string;
  kind: 'product' | 'service';
  unitPricePaise: number;
  unitCostPaise: number;
  productId?: string;
};

export type ConstraintCheck = {
  code: string;
  passed: boolean;
  observed: string;
  required: string;
};

export type QuoteOption = {
  key: 'best-value' | 'balanced' | 'premium-under-cap';
  recommended?: boolean;
  label: string;
  rationale: string;
  lines: QuoteLine[];
  productUnitPaise: number;
  serviceUnitPaise: number;
  unitTotalPaise: number;
  orderTotalPaise: number;
  unitCostPaise: number;
  contributionMarginBps: number;
  headroomPaise: number;
  checks: ConstraintCheck[];
};

export type QuoteEngineResult =
  | {
      status: 'generated';
      options: QuoteOption[];
      evaluatedCombinations: number;
      feasibleCombinations: number;
    }
  | {
      status: 'rejected';
      reasons: Array<{ code: string; message: string }>;
      evaluatedCombinations: number;
    };
