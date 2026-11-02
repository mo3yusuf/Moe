'use server';
import { redirect } from 'next/navigation';
import { apiFetch } from '@/lib/api';

/** Owner-only (checked by the API): creates/continues Stripe Express onboarding and redirects to Stripe. */
export async function startOnboarding(restaurantId: string) {
  const { url } = await apiFetch<{ url: string }>(`/v1/restaurants/${restaurantId}/payments/onboarding`, { method: 'POST' });
  if (!url.startsWith('https://')) throw new Error('Unexpected onboarding URL');
  redirect(url);
}

export async function openDashboard(restaurantId: string) {
  const { url } = await apiFetch<{ url: string }>(`/v1/restaurants/${restaurantId}/payments/dashboard`, { method: 'POST' });
  if (!url.startsWith('https://')) throw new Error('Unexpected dashboard URL');
  redirect(url);
}
