import type { Request, RequestHandler } from 'express';
import { finishAfterCommit } from '../../lib/afterResponse.js';
import { revalidateTags } from '../../lib/revalidate.js';
import * as banners from './banners.service.js';
import * as home from './home.service.js';
import * as pages from './pages.service.js';
import type {
  CreateBannerBody,
  CreatePageBody,
  CreateSectionBody,
  PutSettingsBody,
  ReorderBody,
  UpdateBannerBody,
  UpdatePageBody,
  UpdateSectionBody,
} from './schema.js';
import * as sections from './sections.service.js';
import * as settings from './settings.service.js';

const idParam = (req: Request) => String(req.params.id);
const ctx = (req: Request) => ({
  log: req.log,
  requestId: String(req.id),
  uploadedById: req.user!.id,
});

/** Revalidation tags (owner 2026-11-22): banners/sections -> home; pages -> page:{slug} (old and new
 *  on a rename); settings -> settings + home + products (VAT/delivery display on product pages). */
const HOME_TAGS = ['home'];
const SETTINGS_TAGS = ['settings', 'home', 'products'];
const pageTags = (slug: string, oldSlug?: string) => [
  `page:${slug}`,
  ...(oldSlug !== undefined && oldSlug !== slug ? [`page:${oldSlug}`] : []),
];

// ---------------------------------------------------------------- public (CMS)

export const getHome: RequestHandler = async (_req, res) => {
  res.status(200).json(await home.getHome());
};

export const getPublicSettings: RequestHandler = async (_req, res) => {
  res.status(200).json(await settings.getPublic());
};

export const getPublicPage: RequestHandler = async (req, res) => {
  res.status(200).json(await pages.getPublicBySlug(String(req.params.slug)));
};

// ---------------------------------------------------------------- banners (ADM-06)

export const listBanners: RequestHandler = async (_req, res) => {
  res.status(200).json(await banners.list());
};

export const createBanner: RequestHandler = async (req, res) => {
  const banner = await banners.create(req.body as CreateBannerBody, ctx(req));
  await finishAfterCommit(
    () => revalidateTags(HOME_TAGS, ctx(req)),
    () => res.status(201).json(banner),
  );
};

export const updateBanner: RequestHandler = async (req, res) => {
  const { banner, release } = await banners.update(
    idParam(req),
    req.body as UpdateBannerBody,
    ctx(req),
  );
  await finishAfterCommit(
    async () => {
      await release();
      await revalidateTags(HOME_TAGS, ctx(req));
    },
    () => res.status(200).json(banner),
  );
};

export const removeBanner: RequestHandler = async (req, res) => {
  const { release } = await banners.remove(idParam(req), ctx(req));
  await finishAfterCommit(
    async () => {
      await release();
      await revalidateTags(HOME_TAGS, ctx(req));
    },
    () => res.status(204).end(),
  );
};

// ---------------------------------------------------------------- home sections (ADM-07)

export const listSections: RequestHandler = async (_req, res) => {
  res.status(200).json(await sections.list());
};

export const createSection: RequestHandler = async (req, res) => {
  const section = await sections.create(req.body as CreateSectionBody, ctx(req));
  await finishAfterCommit(
    () => revalidateTags(HOME_TAGS, ctx(req)),
    () => res.status(201).json(section),
  );
};

export const updateSection: RequestHandler = async (req, res) => {
  const { section, release } = await sections.update(
    idParam(req),
    req.body as UpdateSectionBody,
    ctx(req),
  );
  await finishAfterCommit(
    async () => {
      await release();
      await revalidateTags(HOME_TAGS, ctx(req));
    },
    () => res.status(200).json(section),
  );
};

export const removeSection: RequestHandler = async (req, res) => {
  const { release } = await sections.remove(idParam(req), ctx(req));
  await finishAfterCommit(
    async () => {
      await release();
      await revalidateTags(HOME_TAGS, ctx(req));
    },
    () => res.status(204).end(),
  );
};

export const reorderSections: RequestHandler = async (req, res) => {
  await sections.reorder((req.body as ReorderBody).ids);
  await finishAfterCommit(
    () => revalidateTags(HOME_TAGS, ctx(req)),
    () => res.status(204).end(),
  );
};

// ---------------------------------------------------------------- pages (ADM-08)

export const listPages: RequestHandler = async (_req, res) => {
  res.status(200).json(await pages.list());
};

export const createPage: RequestHandler = async (req, res) => {
  const page = await pages.create(req.body as CreatePageBody);
  await finishAfterCommit(
    () => revalidateTags(pageTags(page.slug), ctx(req)),
    () => res.status(201).json(page),
  );
};

export const updatePage: RequestHandler = async (req, res) => {
  const { page, oldSlug } = await pages.update(idParam(req), req.body as UpdatePageBody);
  await finishAfterCommit(
    () => revalidateTags(pageTags(page.slug, oldSlug), ctx(req)),
    () => res.status(200).json(page),
  );
};

export const removePage: RequestHandler = async (req, res) => {
  const { slug } = await pages.remove(idParam(req));
  await finishAfterCommit(
    () => revalidateTags(pageTags(slug), ctx(req)),
    () => res.status(204).end(),
  );
};

// ---------------------------------------------------------------- settings (ADM-09)

export const getAdminSettings: RequestHandler = async (_req, res) => {
  res.status(200).json(await settings.getAdmin());
};

export const putSettings: RequestHandler = async (req, res) => {
  const { settings: saved, release } = await settings.update(req.body as PutSettingsBody, ctx(req));
  await finishAfterCommit(
    async () => {
      await release();
      await revalidateTags(SETTINGS_TAGS, ctx(req));
    },
    () => res.status(200).json(saved),
  );
};
