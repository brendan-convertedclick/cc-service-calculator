import { Link, Route, Routes } from "react-router-dom";

function Home() {
  return (
    <div className="container mx-auto p-8">
      <h1 className="text-3xl font-bold">CC Service Calculator</h1>
      <p className="text-muted-foreground mt-2">
        Scaffold ready. Waiting on Supabase schema before pages come online.
      </p>
      <nav className="mt-6 flex flex-col gap-2 text-sm">
        <Link to="/services" className="text-primary underline underline-offset-4">
          Services (placeholder)
        </Link>
        <Link to="/rules" className="text-primary underline underline-offset-4">
          Rules (placeholder)
        </Link>
        <Link to="/departments" className="text-primary underline underline-offset-4">
          Departments (placeholder)
        </Link>
        <Link to="/team" className="text-primary underline underline-offset-4">
          Team (placeholder)
        </Link>
      </nav>
    </div>
  );
}

function Stub({ name }: { name: string }) {
  return (
    <div className="container mx-auto p-8">
      <Link to="/" className="text-sm text-muted-foreground">&larr; Home</Link>
      <h1 className="mt-4 text-2xl font-semibold">{name}</h1>
      <p className="text-muted-foreground mt-2">Coming next.</p>
    </div>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/services" element={<Stub name="Services" />} />
      <Route path="/rules" element={<Stub name="Rules" />} />
      <Route path="/departments" element={<Stub name="Departments" />} />
      <Route path="/team" element={<Stub name="Team" />} />
    </Routes>
  );
}
