import { Card, CardContent } from "@/components/ui/card";
import { Construction } from "lucide-react";

export function Placeholder({ title, phase }: { title: string; phase: string }) {
  return (
    <Card>
      <CardContent className="flex flex-col items-center justify-center gap-3 py-16 text-center">
        <div className="rounded-full bg-secondary p-3 text-muted-foreground">
          <Construction className="h-6 w-6" />
        </div>
        <div className="text-lg font-semibold">{title}</div>
        <p className="max-w-sm text-sm text-muted-foreground">
          This page is being migrated to React in {phase}. The backend endpoints are already live.
        </p>
      </CardContent>
    </Card>
  );
}
