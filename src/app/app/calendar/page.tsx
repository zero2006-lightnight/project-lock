import { requireUser } from "@/lib/auth/actions";
import { loadCalendarData } from "@/lib/services/data";
import { CalendarView } from "@/components/app/calendar-view";

export const dynamic = "force-dynamic";

export default async function CalendarPage() {
  const user = await requireUser();
  const data = await loadCalendarData(user.id);
  return <CalendarView initial={data} />;
}
