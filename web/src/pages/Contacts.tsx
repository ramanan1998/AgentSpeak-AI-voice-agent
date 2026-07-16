import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Upload, Trash2, Users, UserPlus, Pencil } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/services/api";
import type { Contact } from "@/types";
import { DataTable, type Column } from "@/components/DataTable";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AddContactDialog } from "@/components/AddContactDialog";

export default function ContactsPage() {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [tags, setTags] = useState<string[]>([]);
  const [tagFilter, setTagFilter] = useState("__all__");
  const [tagInput, setTagInput] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  // Dialog state
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingContact, setEditingContact] = useState<Contact | null>(null);

  const load = useCallback(async () => {
    const [c, t] = await Promise.all([api.listContacts(), api.contactTags()]);
    setContacts(c.contacts);
    setTags(t.tags);
  }, []);

  useEffect(() => { void load().catch((e) => toast.error(String(e))); }, [load]);

  const upload = async () => {
    const file = fileRef.current?.files?.[0];
    const parsedTags = tagInput.split(",").map((s) => s.trim()).filter(Boolean);
    if (!file) return toast.warning("Choose a CSV file.");
    if (parsedTags.length === 0) return toast.warning("Add at least one tag.");
    setBusy(true);
    try {
      const csv = await file.text();
      const res = await api.uploadContacts(csv, parsedTags);
      let msg = `Added ${res.added}, updated ${res.updated}. Total ${res.total}.`;
      if (res.invalid.length) msg += ` Skipped ${res.invalid.length} invalid.`;
      toast.success(msg);
      setTagInput("");
      if (fileRef.current) fileRef.current.value = "";
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    await api.deleteContact(id);
    await load();
  };

  const openAdd = () => {
    setEditingContact(null);
    setDialogOpen(true);
  };

  const openEdit = (contact: Contact) => {
    setEditingContact(contact);
    setDialogOpen(true);
  };

  const handleSaved = async () => {
    toast.success(editingContact ? "Contact updated." : "Contact added.");
    await load();
  };

  const filtered = useMemo(
    () => (tagFilter === "__all__" ? contacts : contacts.filter((c) => c.tags.includes(tagFilter))),
    [contacts, tagFilter],
  );

  const columns: Column<Contact>[] = useMemo(
    () => [
      { key: "sno", header: "S.No", className: "w-16", render: (_r) => "", },
      { key: "name", header: "Name", sortable: true, sortValue: (r) => r.name, render: (r) => <span className="font-medium">{r.name}</span> },
      { key: "phone", header: "Mobile Number", sortable: true, sortValue: (r) => r.phone, render: (r) => <span className="font-mono text-xs text-muted-foreground">{r.phone}</span> },
      {
        key: "tags",
        header: "Tags",
        render: (r) => (
          <div className="flex flex-wrap gap-1">
            {r.tags.map((t) => <Badge key={t} variant="secondary">{t}</Badge>)}
          </div>
        ),
      },
      {
        key: "actions",
        header: "",
        className: "w-20 text-right",
        render: (r) => (
          <div className="flex justify-end gap-1">
            <Button variant="ghost" size="icon" onClick={() => openEdit(r)} title="Edit contact">
              <Pencil className="h-4 w-4 text-muted-foreground" />
            </Button>
            <Button variant="ghost" size="icon" onClick={() => void remove(r.id)} title="Delete contact">
              <Trash2 className="h-4 w-4 text-muted-foreground" />
            </Button>
          </div>
        ),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  // S.No is positional within the filtered list — render via index using a wrapper column
  const columnsWithSno: Column<Contact>[] = useMemo(() => {
    const idOf = new Map(filtered.map((c, i) => [c.id, i + 1] as const));
    return columns.map((c) =>
      c.key === "sno" ? { ...c, render: (r: Contact) => <span className="text-muted-foreground">{idOf.get(r.id)}</span> } : c,
    );
  }, [columns, filtered]);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base"><Users className="h-4 w-4" /> Upload contacts</CardTitle>
          <p className="text-sm text-muted-foreground">CSV format: <code className="rounded bg-secondary px-1">Name, Mobile Number</code>. At least one tag is required.</p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>CSV file</Label>
              <Input ref={fileRef} type="file" accept=".csv,text/csv" />
            </div>
            <div className="space-y-1.5">
              <Label>Tags (comma separated)</Label>
              <Input value={tagInput} onChange={(e) => setTagInput(e.target.value)} placeholder="Warm Leads, Bangalore" />
            </div>
          </div>
          <Button onClick={upload} disabled={busy}><Upload className="h-4 w-4" /> Upload &amp; Tag</Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">All contacts ({contacts.length})</CardTitle>
            <Button size="sm" onClick={openAdd}>
              <UserPlus className="h-4 w-4" /> Add Contact
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <DataTable
            rows={filtered}
            columns={columnsWithSno}
            getRowId={(r) => r.id}
            searchAccessor={(r) => `${r.name} ${r.phone}`}
            searchPlaceholder="Search by name or number…"
            empty="No contacts yet — upload a CSV or add one manually."
            toolbar={
              <Select value={tagFilter} onValueChange={setTagFilter}>
                <SelectTrigger className="w-48"><SelectValue placeholder="All tags" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">All tags</SelectItem>
                  {tags.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                </SelectContent>
              </Select>
            }
          />
        </CardContent>
      </Card>

      <AddContactDialog
        open={dialogOpen}
        contact={editingContact}
        allTags={tags}
        onClose={() => setDialogOpen(false)}
        onSaved={handleSaved}
      />
    </div>
  );
}