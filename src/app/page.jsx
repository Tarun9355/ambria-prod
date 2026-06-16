"use client";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

export default function Home() {
  const router = useRouter();

  useEffect(() => {
    // Check if user has a saved session
    const auth = localStorage.getItem("ambria-auth");
    if (auth) {
      try {
        const user = JSON.parse(auth);
        // Sales roles → Studio, Ops/Admin → IMS
        const salesRoles = ["Sales", "Admin"];
        if (salesRoles.includes(user.role)) {
          router.replace("/studio");
        } else {
          router.replace("/ims");
        }
        return;
      } catch {}
    }
    // No session — show landing
  }, [router]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-indigo-50 to-purple-50">
      <div className="text-center space-y-8">
        <div className="w-20 h-20 bg-indigo-600 rounded-2xl flex items-center justify-center mx-auto shadow-xl">
          <span className="text-3xl font-bold text-white">A</span>
        </div>
        <h1 className="text-4xl font-bold text-gray-900">Ambria</h1>
        <p className="text-gray-500 text-lg">Wedding & Event Décor Management</p>
        <div className="flex gap-4 justify-center">
          <a href="/studio" className="px-8 py-3 bg-indigo-600 text-white rounded-xl font-semibold hover:bg-indigo-700 transition shadow-lg">
            Studio
          </a>
          <a href="/ims" className="px-8 py-3 bg-gray-800 text-white rounded-xl font-semibold hover:bg-gray-900 transition shadow-lg">
            IMS
          </a>
        </div>
      </div>
    </div>
  );
}
