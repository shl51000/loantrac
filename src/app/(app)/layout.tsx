import Sidebar from "@/components/Sidebar";
import TopBar from "@/components/TopBar";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-slate-50">
      <Sidebar />
      <main className="md:ml-64 pt-14 md:pt-0 min-h-screen">
        <div className="p-4 md:p-8">
          <TopBar />
          {children}
        </div>
      </main>
    </div>
  );
}
