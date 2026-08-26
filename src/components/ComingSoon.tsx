export default function ComingSoon({ title }: { title: string }) {
  return (
    <div>
      <h1 className="text-2xl font-bold text-slate-800">{title}</h1>
      <div className="mt-6 bg-white rounded-xl border border-slate-200 p-8 text-center text-sm text-slate-500">
        This screen is being built next.
      </div>
    </div>
  );
}
