'use server';
import { revalidatePath } from 'next/cache';
import { supabaseServer } from '@/lib/supabase/server';

/** Approve/reject a creator's menu tag. The database trigger only allows restaurant owners/managers. */
export async function decideTag(restaurantId: string, videoId: string, menuItemId: string, approve: boolean) {
  const supabase = await supabaseServer();
  const { error } = await supabase.from('video_menu_items').update({ status: approve ? 'approved' : 'rejected' })
    .eq('video_id', videoId).eq('menu_item_id', menuItemId).eq('restaurant_id', restaurantId);
  if (error) throw new Error(error.message);
  revalidatePath(`/restaurant/${restaurantId}/content`);
}
