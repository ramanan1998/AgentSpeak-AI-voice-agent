type BadgeVariant = "default" | "secondary" | "outline" | "success" | "warning" | "destructive" | "muted";

export function statusVariant(status: string): BadgeVariant {
  switch (status) {
    case "Finished":
      return "success";
    case "Calling":
    case "Answered":
      return "default";
    case "No Answer":
      return "warning";
    case "Failed":
      return "destructive";
    default:
      return "muted";
  }
}
