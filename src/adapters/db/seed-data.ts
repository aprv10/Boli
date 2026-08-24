export const DEMO_MERCHANT = {
  id: 'merchant-good-batch',
  name: 'The Good Batch',
  slug: 'the-good-batch',
} as const;

type SeedProduct = {
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

export const SEED_PRODUCTS: SeedProduct[] = [
  { id: 'prod-jute-tote', sku: 'BAG-JUTE-01', name: 'Everyday Jute Tote', category: 'container', tags: ['plastic-free', 'vegan', 'brandable'], unitPricePaise: 14500, unitCostPaise: 8900, availableQuantity: 420, leadTimeDays: 2 },
  { id: 'prod-canvas-tote', sku: 'BAG-CANVAS-02', name: 'Heavy Canvas Carryall', category: 'container', tags: ['plastic-free', 'vegan', 'brandable'], unitPricePaise: 21000, unitCostPaise: 13200, availableQuantity: 230, leadTimeDays: 3 },
  { id: 'prod-kraft-box', sku: 'BOX-KRAFT-01', name: 'Recycled Kraft Gift Box', category: 'container', tags: ['plastic-free', 'vegan', 'brandable', 'recycled'], unitPricePaise: 11800, unitCostPaise: 7200, availableQuantity: 600, leadTimeDays: 2 },
  { id: 'prod-steel-bottle', sku: 'DRINK-STEEL-01', name: 'Mizu Steel Bottle', category: 'drinkware', tags: ['plastic-free', 'vegan', 'brandable'], unitPricePaise: 28500, unitCostPaise: 17800, availableQuantity: 310, leadTimeDays: 3 },
  { id: 'prod-cork-tumbler', sku: 'DRINK-CORK-02', name: 'Cork Sleeve Tumbler', category: 'drinkware', tags: ['vegan', 'brandable'], unitPricePaise: 24500, unitCostPaise: 15100, availableQuantity: 180, leadTimeDays: 3 },
  { id: 'prod-ceramic-mug', sku: 'DRINK-CERAMIC-03', name: 'Studio Ceramic Mug', category: 'drinkware', tags: ['plastic-free', 'vegan', 'brandable'], unitPricePaise: 19500, unitCostPaise: 11900, availableQuantity: 260, leadTimeDays: 4 },
  { id: 'prod-seed-notebook', sku: 'NOTE-SEED-01', name: 'Plantable Seed Notebook', category: 'stationery', tags: ['plastic-free', 'vegan', 'brandable', 'plantable'], unitPricePaise: 12800, unitCostPaise: 7400, availableQuantity: 700, leadTimeDays: 2 },
  { id: 'prod-kraft-notebook', sku: 'NOTE-KRAFT-02', name: 'Recycled Kraft Notebook', category: 'stationery', tags: ['plastic-free', 'vegan', 'brandable', 'recycled'], unitPricePaise: 9800, unitCostPaise: 5500, availableQuantity: 820, leadTimeDays: 2 },
  { id: 'prod-cork-journal', sku: 'NOTE-CORK-03', name: 'Soft Cork Journal', category: 'stationery', tags: ['vegan', 'brandable'], unitPricePaise: 17200, unitCostPaise: 10500, availableQuantity: 210, leadTimeDays: 3 },
  { id: 'prod-bamboo-pen', sku: 'PEN-BAMBOO-01', name: 'Bamboo Click Pen', category: 'stationery', tags: ['vegan', 'brandable'], unitPricePaise: 4200, unitCostPaise: 2200, availableQuantity: 1400, leadTimeDays: 2 },
  { id: 'prod-millet-bar', sku: 'SNACK-MILLET-01', name: 'Cacao Millet Bar', category: 'snack', tags: ['vegan', 'gluten-free'], unitPricePaise: 6500, unitCostPaise: 3900, availableQuantity: 900, leadTimeDays: 1 },
  { id: 'prod-nut-mix', sku: 'SNACK-NUT-02', name: 'Smoked Nut Trail Mix', category: 'snack', tags: ['vegan', 'gluten-free', 'plastic-free'], unitPricePaise: 9200, unitCostPaise: 5800, availableQuantity: 540, leadTimeDays: 2 },
  { id: 'prod-chai', sku: 'SNACK-CHAI-03', name: 'Masala Chai Tin', category: 'snack', tags: ['vegan', 'plastic-free'], unitPricePaise: 11000, unitCostPaise: 6800, availableQuantity: 340, leadTimeDays: 2 },
  { id: 'prod-cookies', sku: 'SNACK-COOKIE-04', name: 'Butter Shortbread Box', category: 'snack', tags: ['vegetarian', 'contains-dairy'], unitPricePaise: 12500, unitCostPaise: 7900, availableQuantity: 460, leadTimeDays: 2 },
  { id: 'prod-coffee', sku: 'SNACK-COFFEE-05', name: 'South Indian Coffee Sachets', category: 'snack', tags: ['vegan', 'plastic-free'], unitPricePaise: 7800, unitCostPaise: 4700, availableQuantity: 620, leadTimeDays: 2 },
  { id: 'prod-desk-plant', sku: 'ACC-PLANT-01', name: 'Tiny Desk Grow Kit', category: 'accessory', tags: ['vegan', 'plastic-free', 'plantable'], unitPricePaise: 15500, unitCostPaise: 9600, availableQuantity: 240, leadTimeDays: 3 },
  { id: 'prod-cable-wrap', sku: 'ACC-CORK-02', name: 'Cork Cable Wrap', category: 'accessory', tags: ['vegan', 'brandable'], unitPricePaise: 6900, unitCostPaise: 3800, availableQuantity: 480, leadTimeDays: 2 },
  { id: 'prod-badge', sku: 'ACC-BADGE-03', name: 'Enamel Welcome Badge', category: 'accessory', tags: ['brandable'], unitPricePaise: 8500, unitCostPaise: 5100, availableQuantity: 800, leadTimeDays: 5 },
  { id: 'prod-wrap', sku: 'PACK-WRAP-01', name: 'Recycled Tissue Wrap', category: 'packaging', tags: ['plastic-free', 'vegan', 'recycled'], unitPricePaise: 3200, unitCostPaise: 1700, availableQuantity: 1600, leadTimeDays: 1 },
  { id: 'prod-note-card', sku: 'PACK-CARD-02', name: 'Personal Welcome Card', category: 'packaging', tags: ['plastic-free', 'vegan', 'brandable'], unitPricePaise: 2800, unitCostPaise: 1300, availableQuantity: 2000, leadTimeDays: 2 },
];
