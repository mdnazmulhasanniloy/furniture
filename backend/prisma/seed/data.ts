// Static seed content. Money is integer halalas (SAR, ADR-008). Every text is { en, ar } (ADR-006).
import type { Condition, ProductType, SectionType } from '@prisma/client';

type L = { en: string; ar: string };

export const CATEGORIES: { slug: string; name: L; sortOrder: number }[] = [
  { slug: 'living-room', name: { en: 'Living Room', ar: 'غرفة المعيشة' }, sortOrder: 1 },
  { slug: 'bedroom', name: { en: 'Bedroom', ar: 'غرفة النوم' }, sortOrder: 2 },
  { slug: 'dining', name: { en: 'Dining', ar: 'غرفة الطعام' }, sortOrder: 3 },
  { slug: 'office', name: { en: 'Office', ar: 'المكتب' }, sortOrder: 4 },
  { slug: 'storage', name: { en: 'Storage', ar: 'التخزين' }, sortOrder: 5 },
  { slug: 'outdoor', name: { en: 'Outdoor', ar: 'الأماكن الخارجية' }, sortOrder: 6 },
];

export const DELIVERY_CITIES: { code: string; name: L }[] = [
  { code: 'riyadh', name: { en: 'Riyadh', ar: 'الرياض' } },
  { code: 'jeddah', name: { en: 'Jeddah', ar: 'جدة' } },
  { code: 'mecca', name: { en: 'Mecca', ar: 'مكة المكرمة' } },
  { code: 'medina', name: { en: 'Medina', ar: 'المدينة المنورة' } },
  { code: 'dammam', name: { en: 'Dammam', ar: 'الدمام' } },
  { code: 'khobar', name: { en: 'Khobar', ar: 'الخبر' } },
];

export const HOME_SECTIONS: { type: SectionType; title: L; config: Record<string, unknown> }[] = [
  { type: 'CATEGORY_GRID', title: { en: 'Shop by category', ar: 'تسوق حسب الفئة' }, config: {} },
  { type: 'NEW_ARRIVALS', title: { en: 'New arrivals', ar: 'وصل حديثاً' }, config: { limit: 8 } },
  {
    type: 'FEATURED_PRODUCTS',
    title: { en: 'Featured', ar: 'منتجات مميزة' },
    config: { limit: 8 },
  },
  {
    type: 'RESALE_PICKS',
    title: { en: 'Pre-owned picks', ar: 'مختارات مستعملة' },
    config: { limit: 8 },
  },
];

/** Body of a policy page until the owner writes it (owner 2026-11-24, QA item 8). */
const COMING_SOON: L = {
  en: 'Content coming soon.',
  ar: 'المحتوى قريبًا.',
};

export const PAGES: {
  slug: string;
  title: L;
  content: L;
  isPublished: boolean;
}[] = [
  {
    slug: 'about',
    title: { en: 'About us', ar: 'من نحن' },
    content: {
      en: '<p>Furnixa offers new and pre-owned furniture delivered to your door in the cities we serve.</p>',
      ar: '<p>تقدم فرنيكسا أثاثاً جديداً ومستعملاً يصل إلى بابك في المدن التي نخدمها.</p>',
    },
    isPublished: true,
  },
  {
    slug: 'faq',
    title: { en: 'FAQ', ar: 'الأسئلة الشائعة' },
    content: {
      en: '<h2>How do I pay?</h2><p>Cash on delivery.</p><h2>Where do you deliver?</h2><p>Riyadh, Jeddah, Mecca, Medina, Dammam and Khobar.</p>',
      ar: '<h2>كيف أدفع؟</h2><p>الدفع نقداً عند الاستلام.</p><h2>أين تقومون بالتوصيل؟</h2><p>الرياض وجدة ومكة المكرمة والمدينة المنورة والدمام والخبر.</p>',
    },
    isPublished: true,
  },
  {
    slug: 'contact',
    title: { en: 'Contact us', ar: 'اتصل بنا' },
    content: {
      en: '<p>Write to us and we will reply within one business day.</p>',
      ar: '<p>راسلنا وسنرد عليك خلال يوم عمل واحد.</p>',
    },
    isPublished: true,
  },
  // The policy pages are seeded as DRAFTS (owner 2026-11-24): a placeholder legal page must never be
  // published, so the storefront footer links none of them until the owner writes the real text in the
  // admin and publishes it. Saudi e-commerce rules require all three before launch (launch blocker B-040).
  {
    slug: 'terms',
    title: { en: 'Terms and conditions', ar: 'الشروط والأحكام' },
    content: { en: `<p>${COMING_SOON.en}</p>`, ar: `<p>${COMING_SOON.ar}</p>` },
    isPublished: false,
  },
  {
    slug: 'privacy',
    title: { en: 'Privacy policy', ar: 'سياسة الخصوصية' },
    content: { en: `<p>${COMING_SOON.en}</p>`, ar: `<p>${COMING_SOON.ar}</p>` },
    isPublished: false,
  },
  {
    slug: 'returns',
    title: { en: 'Return and refund policy', ar: 'سياسة الإرجاع والاسترجاع' },
    content: { en: `<p>${COMING_SOON.en}</p>`, ar: `<p>${COMING_SOON.ar}</p>` },
    isPublished: false,
  },
];

interface DemoProduct {
  slug: string;
  category: string;
  type: ProductType;
  condition: Condition;
  title: L;
  description: L;
  price: number;
  stock: number;
  isFeatured?: boolean;
}

const desc = (en: string, ar: string): L => ({ en, ar });

export const DEMO_PRODUCTS: DemoProduct[] = [
  {
    slug: 'oslo-three-seat-sofa',
    category: 'living-room',
    type: 'NEW',
    condition: 'NEW',
    title: { en: 'Oslo three-seat sofa', ar: 'أريكة أوسلو بثلاثة مقاعد' },
    description: desc(
      'Linen-blend sofa with a solid wood frame.',
      'أريكة بقماش كتان مع هيكل من الخشب الصلب.',
    ),
    price: 249900,
    stock: 6,
    isFeatured: true,
  },
  {
    slug: 'nordic-coffee-table',
    category: 'living-room',
    type: 'NEW',
    condition: 'NEW',
    title: { en: 'Nordic coffee table', ar: 'طاولة قهوة نورديك' },
    description: desc('Oak-veneer round coffee table.', 'طاولة قهوة مستديرة بقشرة البلوط.'),
    price: 59900,
    stock: 12,
  },
  {
    slug: 'arden-queen-bed',
    category: 'bedroom',
    type: 'NEW',
    condition: 'NEW',
    title: { en: 'Arden queen bed', ar: 'سرير أردن كوين' },
    description: desc('Upholstered queen bed frame.', 'سرير كوين منجد.'),
    price: 189900,
    stock: 4,
    isFeatured: true,
  },
  {
    slug: 'milan-wardrobe',
    category: 'bedroom',
    type: 'NEW',
    condition: 'NEW',
    title: { en: 'Milan three-door wardrobe', ar: 'خزانة ميلانو بثلاثة أبواب' },
    description: desc('Three-door wardrobe with mirror.', 'خزانة بثلاثة أبواب مع مرآة.'),
    price: 159900,
    stock: 5,
  },
  {
    slug: 'cedar-dining-table',
    category: 'dining',
    type: 'NEW',
    condition: 'NEW',
    title: { en: 'Cedar dining table', ar: 'طاولة طعام سيدر' },
    description: desc('Six-seat solid wood dining table.', 'طاولة طعام من الخشب الصلب لستة أشخاص.'),
    price: 129900,
    stock: 7,
    isFeatured: true,
  },
  {
    slug: 'lumen-office-desk',
    category: 'office',
    type: 'NEW',
    condition: 'NEW',
    title: { en: 'Lumen office desk', ar: 'مكتب لومن' },
    description: desc('Compact desk with cable tray.', 'مكتب صغير مع حامل أسلاك.'),
    price: 69900,
    stock: 10,
  },
  {
    slug: 'vintage-leather-armchair',
    category: 'living-room',
    type: 'RESALE',
    condition: 'GOOD',
    title: { en: 'Vintage leather armchair', ar: 'كرسي جلد كلاسيكي' },
    description: desc(
      'Pre-owned leather armchair, minor wear.',
      'كرسي جلد مستعمل، علامات استخدام بسيطة.',
    ),
    price: 45000,
    stock: 1,
  },
  {
    slug: 'teak-sideboard',
    category: 'dining',
    type: 'RESALE',
    condition: 'LIKE_NEW',
    title: { en: 'Teak sideboard', ar: 'بوفيه خشب الساج' },
    description: desc('Teak sideboard in excellent condition.', 'بوفيه من خشب الساج بحالة ممتازة.'),
    price: 89000,
    stock: 1,
  },
  {
    slug: 'pine-bookcase',
    category: 'storage',
    type: 'RESALE',
    condition: 'GOOD',
    title: { en: 'Pine bookcase', ar: 'مكتبة خشب الصنوبر' },
    description: desc('Five-shelf pine bookcase.', 'مكتبة من الصنوبر بخمسة أرفف.'),
    price: 22000,
    stock: 2,
  },
  {
    slug: 'rattan-garden-set',
    category: 'outdoor',
    type: 'RESALE',
    condition: 'FAIR',
    title: { en: 'Rattan garden set', ar: 'طقم حديقة روطان' },
    description: desc(
      'Four-piece rattan set, some fading.',
      'طقم من أربع قطع، بعض البهتان في اللون.',
    ),
    price: 35000,
    stock: 1,
  },
  {
    slug: 'oak-bedside-table',
    category: 'bedroom',
    type: 'RESALE',
    condition: 'LIKE_NEW',
    title: { en: 'Oak bedside table', ar: 'طاولة جانبية من البلوط' },
    description: desc('Oak bedside table with one drawer.', 'طاولة جانبية من البلوط بدرج واحد.'),
    price: 18000,
    stock: 3,
  },
  {
    slug: 'ergonomic-office-chair',
    category: 'office',
    type: 'RESALE',
    condition: 'GOOD',
    title: { en: 'Ergonomic office chair', ar: 'كرسي مكتب مريح' },
    description: desc('Adjustable chair, lightly used.', 'كرسي قابل للتعديل، استخدام خفيف.'),
    price: 27000,
    stock: 2,
  },
];
