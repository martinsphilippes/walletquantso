"use client";

import { LoginGate } from "@/components/LoginGate";
import { CategoryManager } from "@/components/CategoryManager";

export default function SubcategoriesPage() {
  return (
    <>
      <h1>Subcategorias</h1>
      <LoginGate>
        <CategoryManager mode="sub" />
      </LoginGate>
    </>
  );
}
