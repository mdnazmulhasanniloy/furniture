/**
 * Static demo content: bilingual (en + ar), Saudi context. Money is integer halalas (SAR x 100).
 * Image slots refer to `images.json` themes; the seed picks photos from those pools.
 */

export type L = { en: string; ar: string };
export const sar = (riyals: number): number => Math.round(riyals * 100);

export interface DemoCategory {
  slug: string;
  name: L;
  theme: string; // images.json theme used for the category image and its products
  children?: { slug: string; name: L }[];
}

export const CATEGORIES: DemoCategory[] = [
  {
    slug: 'living-room-sofas',
    name: { en: 'Living Room Sofas', ar: 'أرائك غرفة المعيشة' },
    theme: 'sofas',
    children: [
      { slug: 'corner-sofas', name: { en: 'Corner Sofas', ar: 'أرائك زاوية' } },
      {
        slug: 'three-seater-sofas',
        name: { en: 'Three-Seater Sofas', ar: 'أرائك ثلاثية المقاعد' },
      },
    ],
  },
  { slug: 'armchairs', name: { en: 'Armchairs', ar: 'كراسي بذراعين' }, theme: 'armchairs' },
  {
    slug: 'dining-tables',
    name: { en: 'Dining Tables', ar: 'طاولات الطعام' },
    theme: 'dining-tables',
  },
  {
    slug: 'dining-chairs',
    name: { en: 'Dining Chairs', ar: 'كراسي الطعام' },
    theme: 'dining-chairs',
  },
  {
    slug: 'beds',
    name: { en: 'Beds', ar: 'الأسرّة' },
    theme: 'beds',
    children: [
      { slug: 'king-beds', name: { en: 'King Beds', ar: 'أسرّة كينج' } },
      { slug: 'single-beds', name: { en: 'Single Beds', ar: 'أسرّة مفردة' } },
    ],
  },
  { slug: 'wardrobes', name: { en: 'Wardrobes', ar: 'خزائن الملابس' }, theme: 'wardrobes' },
  { slug: 'office-desks', name: { en: 'Office Desks', ar: 'مكاتب' }, theme: 'office-desks' },
  {
    slug: 'decor-lighting',
    name: { en: 'Decor & Lighting', ar: 'ديكور وإضاءة' },
    theme: 'decor-lighting',
  },
];

/**
 * Four products per top-level category, in this order: NEW, NEW, RESALE, RESALE (16 + 16).
 * `sub` puts the product in a sub-category; `soldOut` => stock 0; `draft` => DRAFT.
 */
export interface DemoProduct {
  slug: string;
  category: string;
  sub?: string;
  title: L;
  description: L;
  sku: string;
  priceSar: number;
  wasSar?: number; // compareAtPrice
  material: string;
  color: string;
  dims: [number, number, number, number]; // width, depth, height cm, weight kg
  soldOut?: boolean;
  draft?: boolean;
}

export const PRODUCTS: DemoProduct[] = [
  // ---- sofas
  {
    slug: 'milano-l-shaped-corner-sofa',
    category: 'living-room-sofas',
    sub: 'corner-sofas',
    title: { en: 'Milano L-Shaped Corner Sofa', ar: 'أريكة ميلانو زاوية على شكل L' },
    description: {
      en: 'A generous corner sofa with deep seats and a solid hardwood frame, upholstered in a soft linen blend that suits warm, bright living rooms.',
      ar: 'أريكة زاوية واسعة بمقاعد عميقة وهيكل متين من الخشب الصلب، مكسوّة بقماش كتان ناعم يناسب غرف المعيشة الدافئة والمشرقة.',
    },
    sku: 'FX-SOF-001',
    priceSar: 9800,
    wasSar: 11500,
    material: 'Linen blend, hardwood frame',
    color: 'Warm grey',
    dims: [280, 180, 85, 68],
  },
  {
    slug: 'riviera-three-seater-sofa',
    category: 'living-room-sofas',
    sub: 'three-seater-sofas',
    title: { en: 'Riviera Three-Seater Sofa', ar: 'أريكة ريفييرا ثلاثية المقاعد' },
    description: {
      en: 'A three-seater in textured bouclé with slim beech legs and removable cushion covers for easy cleaning.',
      ar: 'أريكة بثلاثة مقاعد بقماش بوكليه منقوش وأرجل رفيعة من خشب الزان وأغطية وسائد قابلة للإزالة لسهولة التنظيف.',
    },
    sku: 'FX-SOF-002',
    priceSar: 5400,
    material: 'Bouclé fabric, beech wood',
    color: 'Cream',
    dims: [210, 92, 84, 42],
  },
  {
    slug: 'nordic-corner-sofa-pre-owned',
    category: 'living-room-sofas',
    sub: 'corner-sofas',
    title: { en: 'Nordic Corner Sofa (Pre-owned)', ar: 'أريكة نورديك زاوية (مستعملة)' },
    description: {
      en: 'Pre-owned corner sofa from a smoke-free, pet-free home. Frame is solid and the cushions have been professionally cleaned.',
      ar: 'أريكة زاوية مستعملة من منزل خالٍ من التدخين والحيوانات الأليفة. الهيكل متين والوسائد منظّفة باحتراف.',
    },
    sku: 'FX-SOF-003',
    priceSar: 3600,
    material: 'Fabric, pine frame',
    color: 'Sage green',
    dims: [260, 160, 82, 55],
  },
  {
    slug: 'classic-chesterfield-three-seater',
    category: 'living-room-sofas',
    sub: 'three-seater-sofas',
    soldOut: true,
    title: { en: 'Classic Chesterfield Three-Seater', ar: 'أريكة تشيسترفيلد كلاسيكية ثلاثية' },
    description: {
      en: 'A deep-buttoned Chesterfield with rolled arms. Pre-owned single piece with a rich, lived-in patina.',
      ar: 'أريكة تشيسترفيلد بأزرار عميقة وذراعين مستديرتين. قطعة مستعملة فريدة بلمسة عتيقة أنيقة.',
    },
    sku: 'FX-SOF-004',
    priceSar: 4200,
    material: 'Faux leather, hardwood frame',
    color: 'Chestnut brown',
    dims: [200, 90, 78, 60],
  },
  // ---- armchairs
  {
    slug: 'aria-velvet-accent-armchair',
    category: 'armchairs',
    title: { en: 'Aria Velvet Accent Armchair', ar: 'كرسي أريا المخملي' },
    description: {
      en: 'A sculpted accent chair in soft velvet with gold-finish steel legs, a statement piece for any reading corner.',
      ar: 'كرسي بتصميم منحوت بقماش مخملي ناعم وأرجل فولاذية بلمسة ذهبية، قطعة مميزة لأي ركن قراءة.',
    },
    sku: 'FX-ARM-001',
    priceSar: 1450,
    wasSar: 1850,
    material: 'Velvet, steel legs',
    color: 'Emerald green',
    dims: [74, 78, 82, 11],
  },
  {
    slug: 'oslo-wingback-armchair',
    category: 'armchairs',
    draft: true,
    title: { en: 'Oslo Wingback Armchair', ar: 'كرسي أوسلو بظهر مرتفع' },
    description: {
      en: 'A classic wingback with a high, supportive back and solid oak legs.',
      ar: 'كرسي كلاسيكي بظهر مرتفع ومريح وأرجل من خشب البلوط الصلب.',
    },
    sku: 'FX-ARM-002',
    priceSar: 2100,
    material: 'Fabric, oak legs',
    color: 'Oatmeal',
    dims: [78, 82, 108, 16],
  },
  {
    slug: 'scandi-lounge-armchair-pre-owned',
    category: 'armchairs',
    title: { en: 'Scandi Lounge Armchair (Pre-owned)', ar: 'كرسي سكاندي للاسترخاء (مستعمل)' },
    description: {
      en: 'Light oak frame with a removable grey seat cushion. Light wear on the arms, otherwise in very good shape.',
      ar: 'هيكل من البلوط الفاتح مع وسادة رمادية قابلة للإزالة. آثار استخدام خفيفة على الذراعين وحالته جيدة جداً.',
    },
    sku: 'FX-ARM-003',
    priceSar: 650,
    material: 'Oak, fabric cushion',
    color: 'Light grey',
    dims: [70, 75, 80, 9],
  },
  {
    slug: 'leather-club-armchair-pre-owned',
    category: 'armchairs',
    title: { en: 'Leather Club Armchair (Pre-owned)', ar: 'كرسي نادي جلدي (مستعمل)' },
    description: {
      en: 'A roomy leather club chair that has softened beautifully with age. Minor creasing on the seat.',
      ar: 'كرسي نادي جلدي واسع ازداد نعومة مع الزمن. تجاعيد طفيفة على المقعد.',
    },
    sku: 'FX-ARM-004',
    priceSar: 1100,
    material: 'Genuine leather, wood frame',
    color: 'Tan',
    dims: [88, 90, 80, 24],
  },
  // ---- dining tables
  {
    slug: 'layla-oak-dining-table-6-seater',
    category: 'dining-tables',
    title: { en: 'Layla Oak Dining Table (6-Seater)', ar: 'طاولة طعام ليلى من البلوط (6 مقاعد)' },
    description: {
      en: 'A solid oak dining table with a natural oil finish that seats six comfortably. Built to host family gatherings.',
      ar: 'طاولة طعام من خشب البلوط الصلب بطلاء زيتي طبيعي تتسع لستة أشخاص بارتياح. مصممة للمجالس والتجمعات العائلية.',
    },
    sku: 'FX-DTB-001',
    priceSar: 4800,
    wasSar: 5600,
    material: 'Solid oak',
    color: 'Natural oak',
    dims: [180, 90, 75, 48],
  },
  {
    slug: 'marmara-round-dining-table',
    category: 'dining-tables',
    title: { en: 'Marmara Round Dining Table', ar: 'طاولة طعام مارمارا مستديرة' },
    description: {
      en: 'A round pedestal table with a white top and walnut veneer base, ideal for smaller dining rooms.',
      ar: 'طاولة مستديرة بقاعدة مركزية، سطح أبيض وقاعدة بقشرة الجوز، مثالية لغرف الطعام الصغيرة.',
    },
    sku: 'FX-DTB-002',
    priceSar: 3200,
    material: 'MDF, walnut veneer',
    color: 'White and walnut',
    dims: [120, 120, 75, 38],
  },
  {
    slug: 'extendable-walnut-dining-table-pre-owned',
    category: 'dining-tables',
    title: {
      en: 'Extendable Walnut Dining Table (Pre-owned)',
      ar: 'طاولة طعام جوز قابلة للتمديد (مستعملة)',
    },
    description: {
      en: 'Extends from 160 to 220 cm for larger gatherings. A few light surface marks, refinished edges.',
      ar: 'تمتد من 160 إلى 220 سم للتجمعات الكبيرة. خدوش سطحية خفيفة مع حواف معاد طلاؤها.',
    },
    sku: 'FX-DTB-003',
    priceSar: 2400,
    material: 'Walnut',
    color: 'Dark walnut',
    dims: [160, 90, 76, 45],
  },
  {
    slug: 'industrial-dining-table-pre-owned',
    category: 'dining-tables',
    soldOut: true,
    title: { en: 'Industrial Dining Table (Pre-owned)', ar: 'طاولة طعام صناعية (مستعملة)' },
    description: {
      en: 'Reclaimed wood top on a black steel frame. A one-off pre-owned piece with real character.',
      ar: 'سطح من الخشب المعاد تدويره على هيكل فولاذي أسود. قطعة مستعملة فريدة بطابع مميز.',
    },
    sku: 'FX-DTB-004',
    priceSar: 1500,
    material: 'Reclaimed wood, steel',
    color: 'Rustic brown',
    dims: [170, 85, 76, 52],
  },
  // ---- dining chairs
  {
    slug: 'luna-dining-chairs-set-of-4',
    category: 'dining-chairs',
    title: { en: 'Luna Dining Chairs (Set of 4)', ar: 'كراسي طعام لونا (طقم 4)' },
    description: {
      en: 'Four curved-back dining chairs with padded seats and beech legs, delivered flat-packed with fittings.',
      ar: 'أربعة كراسي طعام بظهر منحنٍ ومقاعد مبطنة وأرجل من خشب الزان، تصل مفككة مع قطع التركيب.',
    },
    sku: 'FX-DCH-001',
    priceSar: 1800,
    wasSar: 2200,
    material: 'Fabric, beech wood',
    color: 'Light beige',
    dims: [46, 52, 84, 18],
  },
  {
    slug: 'capri-rattan-dining-chair',
    category: 'dining-chairs',
    title: { en: 'Capri Rattan Dining Chair', ar: 'كرسي طعام كابري من الروطان' },
    description: {
      en: 'A hand-woven rattan chair that adds a light, natural look to the dining room.',
      ar: 'كرسي من الروطان المنسوج يدوياً يضيف مظهراً خفيفاً وطبيعياً لغرفة الطعام.',
    },
    sku: 'FX-DCH-002',
    priceSar: 450,
    material: 'Rattan, wood',
    color: 'Natural',
    dims: [48, 55, 82, 5],
  },
  {
    slug: 'wooden-dining-chairs-set-of-6-pre-owned',
    category: 'dining-chairs',
    title: {
      en: 'Wooden Dining Chairs (Set of 6, Pre-owned)',
      ar: 'كراسي طعام خشبية (طقم 6، مستعمل)',
    },
    description: {
      en: 'A matching set of six solid beech chairs. Sturdy joints; two seats have small cosmetic scuffs.',
      ar: 'طقم من ستة كراسي متطابقة من خشب الزان الصلب. المفاصل متينة، ومقعدان بهما خدوش تجميلية صغيرة.',
    },
    sku: 'FX-DCH-003',
    priceSar: 1200,
    material: 'Beech wood',
    color: 'Walnut',
    dims: [45, 50, 90, 26],
  },
  {
    slug: 'velvet-dining-chairs-pair-pre-owned',
    category: 'dining-chairs',
    title: { en: 'Velvet Dining Chairs (Pair, Pre-owned)', ar: 'كراسي طعام مخمل (زوج، مستعملة)' },
    description: {
      en: 'A pair of dusty-pink velvet chairs with gold legs. Seats show light wear.',
      ar: 'زوج كراسي مخمل وردي هادئ بأرجل ذهبية. المقاعد عليها آثار استخدام خفيفة.',
    },
    sku: 'FX-DCH-004',
    priceSar: 520,
    material: 'Velvet, metal legs',
    color: 'Dusty pink',
    dims: [50, 56, 86, 14],
  },
  // ---- beds
  {
    slug: 'royal-king-upholstered-bed',
    category: 'beds',
    sub: 'king-beds',
    title: { en: 'Royal King Upholstered Bed', ar: 'سرير رويال كينج منجّد' },
    description: {
      en: 'A king bed with a tall tufted headboard, upholstered in soft fabric, with sturdy slats that need no box spring.',
      ar: 'سرير كينج بمسند رأس مرتفع ومزيّن بالأزرار، مكسوّ بقماش ناعم، مع ألواح داعمة متينة لا تحتاج إلى قاعدة إضافية.',
    },
    sku: 'FX-BED-001',
    priceSar: 12000,
    wasSar: 13900,
    material: 'Fabric, plywood, hardwood slats',
    color: 'Taupe',
    dims: [215, 205, 120, 95],
  },
  {
    slug: 'bergen-single-wooden-bed',
    category: 'beds',
    sub: 'single-beds',
    title: { en: 'Bergen Single Wooden Bed', ar: 'سرير بيرغن مفرد خشبي' },
    description: {
      en: 'A clean-lined single bed in solid pine with a slatted base, ideal for kids and guest rooms.',
      ar: 'سرير مفرد بخطوط بسيطة من خشب الصنوبر الصلب مع قاعدة بألواح، مثالي لغرف الأطفال والضيوف.',
    },
    sku: 'FX-BED-002',
    priceSar: 1750,
    material: 'Solid pine',
    color: 'Natural pine',
    dims: [105, 205, 90, 28],
  },
  {
    slug: 'king-bed-frame-with-storage-pre-owned',
    category: 'beds',
    sub: 'king-beds',
    title: {
      en: 'King Bed Frame with Storage (Pre-owned)',
      ar: 'هيكل سرير كينج مع تخزين (مستعمل)',
    },
    description: {
      en: 'King frame with two large under-bed drawers. Mattress not included. Drawer runners work smoothly.',
      ar: 'هيكل سرير كينج مع درجين كبيرين تحت السرير. المرتبة غير متضمنة. مجاري الأدراج تعمل بسلاسة.',
    },
    sku: 'FX-BED-003',
    priceSar: 2900,
    material: 'Engineered wood',
    color: 'Greige',
    dims: [210, 200, 100, 80],
  },
  {
    slug: 'single-metal-bed-frame-pre-owned',
    category: 'beds',
    sub: 'single-beds',
    title: { en: 'Single Metal Bed Frame (Pre-owned)', ar: 'هيكل سرير مفرد معدني (مستعمل)' },
    description: {
      en: 'A sturdy black metal single frame. Some touched-up paint at the corners.',
      ar: 'هيكل سرير مفرد معدني أسود متين. بعض الزوايا أُعيد طلاؤها.',
    },
    sku: 'FX-BED-004',
    priceSar: 380,
    material: 'Powder-coated steel',
    color: 'Matte black',
    dims: [100, 200, 90, 14],
  },
  // ---- wardrobes
  {
    slug: 'sahara-3-door-sliding-wardrobe',
    category: 'wardrobes',
    title: { en: 'Sahara 3-Door Sliding Wardrobe', ar: 'خزانة صحراء بثلاثة أبواب منزلقة' },
    description: {
      en: 'A wide wardrobe with soft-close sliding doors, hanging rails and adjustable shelves, in an off-white finish.',
      ar: 'خزانة واسعة بأبواب منزلقة بإغلاق هادئ وقضبان تعليق ورفوف قابلة للتعديل بلون أبيض مائل للعاج.',
    },
    sku: 'FX-WRD-001',
    priceSar: 5200,
    wasSar: 6100,
    material: 'Engineered wood',
    color: 'Off-white',
    dims: [240, 60, 220, 120],
  },
  {
    slug: 'madar-2-door-wardrobe',
    category: 'wardrobes',
    title: { en: 'Madar 2-Door Wardrobe', ar: 'خزانة مدار بابين' },
    description: {
      en: 'A compact two-door wardrobe with a walnut finish, a hanging rail and a shelf for folded clothes.',
      ar: 'خزانة مدمجة بابين بلون الجوز مع قضيب تعليق ورف للملابس المطوية.',
    },
    sku: 'FX-WRD-002',
    priceSar: 2600,
    material: 'Engineered wood',
    color: 'Walnut',
    dims: [120, 55, 200, 64],
  },
  {
    slug: 'mirrored-4-door-wardrobe-pre-owned',
    category: 'wardrobes',
    title: { en: 'Mirrored 4-Door Wardrobe (Pre-owned)', ar: 'خزانة بأربعة أبواب بمرآة (مستعملة)' },
    description: {
      en: 'Four doors, two with full-length mirrors. Disassembled for transport. Small chips on the base trim.',
      ar: 'أربعة أبواب، اثنان منها بمرايا كاملة الطول. تُسلَّم مفككة. رقائق صغيرة في حافة القاعدة.',
    },
    sku: 'FX-WRD-003',
    priceSar: 1900,
    material: 'Engineered wood, mirror glass',
    color: 'White',
    dims: [200, 58, 210, 98],
  },
  {
    slug: 'vintage-oak-armoire-pre-owned',
    category: 'wardrobes',
    draft: true,
    title: { en: 'Vintage Oak Armoire (Pre-owned)', ar: 'خزانة بلوط عتيقة (مستعملة)' },
    description: {
      en: 'An antique-style oak armoire with carved details. Photos and condition notes to follow.',
      ar: 'خزانة بلوط بطراز عتيق وتفاصيل منحوتة. الصور وملاحظات الحالة قريباً.',
    },
    sku: 'FX-WRD-004',
    priceSar: 1350,
    material: 'Oak',
    color: 'Honey oak',
    dims: [110, 55, 195, 70],
  },
  // ---- desks
  {
    slug: 'orion-standing-desk',
    category: 'office-desks',
    title: { en: 'Orion Height-Adjustable Desk', ar: 'مكتب أوريون قابل لتعديل الارتفاع' },
    description: {
      en: 'An electric sit-stand desk with a quiet dual motor, memory presets and a scratch-resistant oak-look top.',
      ar: 'مكتب كهربائي للجلوس والوقوف بمحرك مزدوج هادئ وذاكرة لحفظ الارتفاعات وسطح مقاوم للخدوش بمظهر البلوط.',
    },
    sku: 'FX-DSK-001',
    priceSar: 3400,
    material: 'Steel frame, laminate top',
    color: 'White and oak',
    dims: [160, 75, 120, 38],
  },
  {
    slug: 'nova-home-office-desk',
    category: 'office-desks',
    title: { en: 'Nova Home Office Desk', ar: 'مكتب نوفا للمنزل' },
    description: {
      en: 'A slim desk with a drawer and cable cut-out, sized for a laptop, monitor and notebook.',
      ar: 'مكتب نحيف بدرج وفتحة للكابلات، بحجم مناسب للابتوب والشاشة والدفتر.',
    },
    sku: 'FX-DSK-002',
    priceSar: 1250,
    material: 'MDF, wood legs',
    color: 'White',
    dims: [120, 55, 75, 22],
  },
  {
    slug: 'executive-wooden-desk-pre-owned',
    category: 'office-desks',
    title: { en: 'Executive Wooden Desk (Pre-owned)', ar: 'مكتب مدير خشبي (مستعمل)' },
    description: {
      en: 'A large executive desk with three drawers and a leather inlay top. Light wear on the inlay.',
      ar: 'مكتب مدير كبير بثلاثة أدراج وسطح بحشوة جلدية. آثار استخدام خفيفة على الحشوة.',
    },
    sku: 'FX-DSK-003',
    priceSar: 2800,
    material: 'Veneered wood, leather inlay',
    color: 'Dark cherry',
    dims: [180, 85, 76, 74],
  },
  {
    slug: 'compact-writing-desk-pre-owned',
    category: 'office-desks',
    title: { en: 'Compact Writing Desk (Pre-owned)', ar: 'مكتب كتابة صغير (مستعمل)' },
    description: {
      en: 'A small writing desk that fits a bedroom corner. Surface has a few visible marks.',
      ar: 'مكتب كتابة صغير يناسب زاوية غرفة النوم. السطح عليه بعض العلامات الظاهرة.',
    },
    sku: 'FX-DSK-004',
    priceSar: 480,
    material: 'Pine',
    color: 'Honey pine',
    dims: [100, 50, 74, 15],
  },
  // ---- decor & lighting
  {
    slug: 'halo-brass-pendant-light',
    category: 'decor-lighting',
    title: { en: 'Halo Brass Pendant Light', ar: 'ثريا هالو نحاسية' },
    description: {
      en: 'A brushed-brass pendant with a warm glow, suitable for dining tables and entryways. Bulb not included.',
      ar: 'ثريا معلقة من النحاس المصقول بإضاءة دافئة، مناسبة لطاولات الطعام والمداخل. المصباح غير مرفق.',
    },
    sku: 'FX-DEC-001',
    priceSar: 890,
    material: 'Brushed brass',
    color: 'Brass',
    dims: [45, 45, 120, 3],
  },
  {
    slug: 'aurora-floor-lamp',
    category: 'decor-lighting',
    title: { en: 'Aurora Floor Lamp', ar: 'مصباح أرضي أورورا' },
    description: {
      en: 'A slender floor lamp with a dimmable warm light and a weighted base that stays steady.',
      ar: 'مصباح أرضي رفيع بإضاءة دافئة قابلة للتعتيم وقاعدة ثقيلة تثبّته في مكانه.',
    },
    sku: 'FX-DEC-002',
    priceSar: 560,
    material: 'Steel, linen shade',
    color: 'Black and ivory',
    dims: [40, 40, 165, 5],
  },
  {
    slug: 'large-round-gold-mirror-pre-owned',
    category: 'decor-lighting',
    title: { en: 'Large Round Gold Mirror (Pre-owned)', ar: 'مرآة مستديرة ذهبية كبيرة (مستعملة)' },
    description: {
      en: 'An 80 cm round mirror with a slim gold frame. Glass is flawless; a small scratch on the frame.',
      ar: 'مرآة مستديرة بقطر 80 سم وإطار ذهبي رفيع. الزجاج بلا عيوب مع خدش صغير على الإطار.',
    },
    sku: 'FX-DEC-003',
    priceSar: 420,
    material: 'Metal frame, glass',
    color: 'Gold',
    dims: [80, 4, 80, 6],
  },
  {
    slug: 'ceramic-vase-set-of-3-pre-owned',
    category: 'decor-lighting',
    title: { en: 'Ceramic Vase Set of 3 (Pre-owned)', ar: 'طقم 3 مزهريات خزفية (مستعمل)' },
    description: {
      en: 'Three hand-finished ceramic vases in graduated sizes. All intact, one with a small glaze mark.',
      ar: 'ثلاث مزهريات خزفية بتشطيب يدوي بأحجام متدرجة. جميعها سليمة، وإحداها بها علامة صغيرة في الطلاء.',
    },
    sku: 'FX-DEC-004',
    priceSar: 150,
    material: 'Ceramic',
    color: 'White',
    dims: [18, 18, 32, 3],
  },
];

export const CONDITION_NOTES: Record<'LIKE_NEW' | 'GOOD' | 'FAIR', L> = {
  LIKE_NEW: {
    en: 'Barely used; no visible marks.',
    ar: 'استُخدمت بالكاد ولا توجد علامات ظاهرة.',
  },
  GOOD: {
    en: 'Light signs of use that do not affect function.',
    ar: 'آثار استخدام خفيفة لا تؤثر على الوظيفة.',
  },
  FAIR: {
    en: 'Visible wear such as scuffs or marks; fully functional.',
    ar: 'آثار استخدام ظاهرة مثل الخدوش أو العلامات، وهي سليمة وظيفياً.',
  },
};

export interface DemoBanner {
  title: L;
  subtitle: L;
  ctaLabel: L;
  ctaHref: string;
  desktopTheme: string;
  mobileTheme: string;
  /** Days from now when the banner starts (null = already live). */
  startsInDays: number | null;
}

export const BANNERS: DemoBanner[] = [
  {
    title: { en: 'Warm living rooms, ready to deliver', ar: 'غرف معيشة دافئة جاهزة للتوصيل' },
    subtitle: {
      en: 'New sofas and armchairs, delivered to your door',
      ar: 'أرائك وكراسي جديدة نوصلها إلى بابك',
    },
    ctaLabel: { en: 'Shop new furniture', ar: 'تسوق الأثاث الجديد' },
    ctaHref: '/shop?type=new',
    desktopTheme: 'hero-desktop',
    mobileTheme: 'hero-mobile',
    startsInDays: null,
  },
  {
    title: { en: 'Pre-owned, for less', ar: 'مستعمل بسعر أقل' },
    subtitle: {
      en: 'One-of-a-kind pieces with the condition described in photos and notes',
      ar: 'قطع فريدة مع وصف الحالة بالصور والملاحظات',
    },
    ctaLabel: { en: 'Browse pre-owned', ar: 'تصفح المستعمل' },
    ctaHref: '/shop?type=resale',
    desktopTheme: 'hero-desktop',
    mobileTheme: 'hero-mobile',
    startsInDays: null,
  },
  {
    title: { en: 'Bedroom refresh collection', ar: 'مجموعة تجديد غرف النوم' },
    subtitle: {
      en: 'Beds and wardrobes, launching next week',
      ar: 'أسرّة وخزائن، تُطلق الأسبوع القادم',
    },
    ctaLabel: { en: 'See beds', ar: 'شاهد الأسرّة' },
    ctaHref: '/shop?category=beds',
    desktopTheme: 'hero-desktop',
    mobileTheme: 'hero-mobile',
    startsInDays: 7,
  },
];

export const TESTIMONIALS = [
  {
    name: 'Demo customer / عميل تجريبي',
    quote: {
      en: '[DEMO] Replace with a real customer review before launch.',
      ar: '[تجريبي] استبدل هذا برأي عميل حقيقي قبل الإطلاق.',
    },
  },
  {
    name: 'Demo customer / عميل تجريبي',
    quote: {
      en: '[DEMO] Placeholder review: delivery and condition were as described.',
      ar: '[تجريبي] رأي مؤقت: التوصيل والحالة كما هو موصوف.',
    },
  },
  {
    name: 'Demo customer / عميل تجريبي',
    quote: {
      en: '[DEMO] Placeholder review: great value for pre-owned furniture.',
      ar: '[تجريبي] رأي مؤقت: قيمة ممتازة مقابل الأثاث المستعمل.',
    },
  },
];

export interface DemoCustomer {
  firstName: string;
  lastName: string;
  email: string;
  locale: 'ar' | 'en';
  area: string;
  street: string;
}

const C = (
  firstName: string,
  lastName: string,
  locale: 'ar' | 'en',
  area: string,
  street: string,
): DemoCustomer => ({
  firstName,
  lastName,
  email: `${firstName}.${lastName}`.toLowerCase().replace(/[^a-z.]/g, '') + '@example.com',
  locale,
  area,
  street,
});

export const CUSTOMERS: DemoCustomer[] = [
  C('Abdullah', 'Al-Harbi', 'ar', 'Al Olaya', 'King Fahd Road'),
  C('Faisal', 'Al-Otaibi', 'ar', 'Al Malqa', 'Anas Ibn Malik Street'),
  C('Nora', 'Al-Qahtani', 'ar', 'Al Yasmin', 'Prince Turki Street'),
  C('Sara', 'Al-Dosari', 'en', 'Al Rawdah', 'Al Tahlia Street'),
  C('Mohammed', 'Al-Ghamdi', 'ar', 'Al Hamra', 'Palestine Street'),
  C('Reem', 'Al-Zahrani', 'ar', 'Al Nakheel', 'Prince Sultan Street'),
  C('Khalid', 'Al-Shehri', 'ar', 'Al Sulimaniyah', 'Al Amir Mohammed Street'),
  C('Lama', 'Al-Mutairi', 'en', 'Al Wurud', 'Al Urubah Road'),
  C('Fahad', 'Al-Subaie', 'ar', 'Al Aziziyah', 'King Abdullah Road'),
  C('Hessa', 'Al-Anazi', 'ar', 'Al Narjis', 'Al Imam Saud Street'),
  C('Turki', 'Al-Shammari', 'ar', 'Al Safa', 'Al Madinah Road'),
  C('Maha', 'Al-Rashid', 'en', 'Al Sahafah', 'Uthman Ibn Affan Road'),
];
