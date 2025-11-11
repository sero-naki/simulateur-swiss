"use client"

import { Sun } from "lucide-react"
import { Button } from "./ui/button"

export function Header() {
  return (
    <header className="absolute top-0 left-0 right-0 z-[2000] flex items-center justify-between p-4 md:p-6 pointer-events-none">
      <div className="flex items-center gap-2 bg-white/95 backdrop-blur-sm px-4 py-2 rounded-lg shadow-md pointer-events-auto">
        <Sun className="h-6 w-6 text-accent" />
        <h1 className="text-xl font-bold text-foreground">Simulateur Solaire</h1>
      </div>
      <div className="pointer-events-auto">
        <Button className="bg-accent hover:bg-accent/90 text-accent-foreground font-semibold shadow-md">
          Devis gratuit !
        </Button>
      </div>
    </header>
  )
}
