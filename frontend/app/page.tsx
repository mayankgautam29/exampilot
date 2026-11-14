"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { Spinner } from "@/components/ui-kit";
import { homeFor, useAuth } from "@/lib/store";

export default function Home() {
  const { user, loading, hydrate } = useAuth();
  const router = useRouter();
  useEffect(() => {
    hydrate();
  }, [hydrate]);
  useEffect(() => {
    if (!loading) router.replace(user ? homeFor(user.role) : "/login");
  }, [loading, user, router]);
  return (
    <div className="flex min-h-screen items-center justify-center">
      <Spinner label="Loading…" />
    </div>
  );
}
