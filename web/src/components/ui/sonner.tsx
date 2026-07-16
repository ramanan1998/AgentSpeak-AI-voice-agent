import { Toaster as SonnerToaster } from "sonner";

/** App-wide toast host. Use `import { toast } from "sonner"` to fire toasts. */
export function Toaster() {
  return (
    <SonnerToaster
      position="bottom-right"
      toastOptions={{
        classNames: {
          toast:
            "group rounded-md border border-border bg-card text-card-foreground shadow-md text-sm",
          description: "text-muted-foreground",
          actionButton: "bg-primary text-primary-foreground",
          cancelButton: "bg-muted text-muted-foreground",
        },
      }}
    />
  );
}
