import { setRequestLocale } from "next-intl/server";

import { SuccessPage } from "@/components/checkout/success-page";

export default async function Success({
  params,
  searchParams,
}: Readonly<{ params: Promise<{ locale: string }>; searchParams: Promise<{ id?: string }> }>) {
  const { locale } = await params;
  const { id } = await searchParams;
  setRequestLocale(locale);
  return <SuccessPage orderId={typeof id === "string" && /^[a-f0-9]{24}$/i.test(id) ? id : null} />;
}
