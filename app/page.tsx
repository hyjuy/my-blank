import { ScheduleApp } from "@/components/ScheduleApp";

export const dynamic = "force-dynamic";

export default function Home() {
  return <ScheduleApp initialNow={new Date().toISOString()} />;
}
