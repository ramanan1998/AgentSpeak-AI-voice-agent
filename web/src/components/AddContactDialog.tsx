import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { api } from "@/services/api";
import type { Contact } from "@/types";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";

const MAX_TAGS = 5;
const INDIAN_MOBILE_RE = /^\+91[6-9]\d{9}$/;

function validatePhone(raw: string): string | null {
  const p = raw.trim().replace(/[\s\-()]/g, "");
  return INDIAN_MOBILE_RE.test(p) ? p : null;
}

interface Props {
  open: boolean;
  contact?: Contact | null;
  allTags: string[];
  onClose: () => void;
  onSaved: () => void;
}

export function AddContactDialog({ open, contact, allTags, onClose, onSaved }: Props) {
  const isEdit = contact != null;

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState("");
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [phoneError, setPhoneError] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const tagInputRef = useRef<HTMLInputElement>(null);
  const suggestionsRef = useRef<HTMLDivElement>(null);

  // Populate fields when editing
  useEffect(() => {
    if (open) {
      setName(contact?.name ?? "");
      setPhone(contact?.phone ?? "");
      setTags(contact?.tags ?? []);
      setTagInput("");
      setPhoneError("");
      setError("");
    }
  }, [open, contact]);

  // Close suggestion dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (
        tagInputRef.current && !tagInputRef.current.contains(e.target as Node) &&
        suggestionsRef.current && !suggestionsRef.current.contains(e.target as Node)
      ) {
        setShowSuggestions(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const suggestions = allTags.filter(
    (t) => t.toLowerCase().includes(tagInput.toLowerCase()) && !tags.includes(t),
  );

  const addTag = (t: string) => {
    const trimmed = t.trim();
    if (!trimmed || tags.includes(trimmed) || tags.length >= MAX_TAGS) return;
    setTags((prev) => [...prev, trimmed]);
    setTagInput("");
    setShowSuggestions(false);
    tagInputRef.current?.focus();
  };

  const removeTag = (t: string) => setTags((prev) => prev.filter((x) => x !== t));

  const handleTagKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (tagInput.trim()) addTag(tagInput);
    } else if (e.key === "Backspace" && !tagInput && tags.length > 0) {
      removeTag(tags[tags.length - 1]);
    }
  };

  const handlePhoneBlur = () => {
    if (!phone) { setPhoneError(""); return; }
    const normalized = validatePhone(phone);
    if (!normalized) {
      setPhoneError("Must start with +91 followed by 10 digits (e.g. +919876543210).");
    } else {
      setPhoneError("");
      setPhone(normalized);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    const trimmedName = name.trim();
    if (!trimmedName) { setError("Name is required."); return; }

    const normalizedPhone = validatePhone(phone);
    if (!normalizedPhone) {
      setPhoneError("Must start with +91 followed by 10 digits (e.g. +919876543210).");
      return;
    }
    if (tags.length > MAX_TAGS) { setError(`Maximum ${MAX_TAGS} tags allowed.`); return; }

    setBusy(true);
    try {
      if (isEdit && contact) {
        await api.updateContact(contact.id, trimmedName, normalizedPhone, tags);
      } else {
        await api.createContact(trimmedName, normalizedPhone, tags);
      }
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit Contact" : "Add Contact"}</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Name */}
          <div className="space-y-1.5">
            <Label htmlFor="contact-name">Name <span className="text-destructive">*</span></Label>
            <Input
              id="contact-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Full name"
              autoFocus
            />
          </div>

          {/* Phone */}
          <div className="space-y-1.5">
            <Label htmlFor="contact-phone">Mobile Number <span className="text-destructive">*</span></Label>
            <Input
              id="contact-phone"
              value={phone}
              onChange={(e) => { setPhone(e.target.value); setPhoneError(""); }}
              onBlur={handlePhoneBlur}
              placeholder="+919876543210"
              className={phoneError ? "border-destructive focus-visible:ring-destructive" : ""}
            />
            {phoneError && <p className="text-xs text-destructive">{phoneError}</p>}
            <p className="text-xs text-muted-foreground">Indian mobile only · starts with +91 · 10 digits after</p>
          </div>

          {/* Tags */}
          <div className="space-y-1.5">
            <Label>
              Tags
              <span className="ml-1.5 text-xs text-muted-foreground">({tags.length}/{MAX_TAGS})</span>
            </Label>

            {/* Chip display + input */}
            <div
              className="flex min-h-10 flex-wrap gap-1.5 rounded-md border bg-background px-3 py-2 focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-0 cursor-text"
              onClick={() => tagInputRef.current?.focus()}
            >
              {tags.map((t) => (
                <Badge key={t} variant="secondary" className="gap-1 pr-1">
                  {t}
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); removeTag(t); }}
                    className="ml-0.5 rounded-full hover:bg-muted-foreground/20 p-0.5"
                  >
                    <X className="h-3 w-3" />
                    <span className="sr-only">Remove {t}</span>
                  </button>
                </Badge>
              ))}
              {tags.length < MAX_TAGS && (
                <input
                  ref={tagInputRef}
                  value={tagInput}
                  onChange={(e) => { setTagInput(e.target.value); setShowSuggestions(true); }}
                  onKeyDown={handleTagKey}
                  onFocus={() => setShowSuggestions(true)}
                  placeholder={tags.length === 0 ? "Type a tag and press Enter…" : ""}
                  className="flex-1 min-w-24 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
                />
              )}
            </div>

            {/* Suggestions dropdown */}
            {showSuggestions && suggestions.length > 0 && (
              <div
                ref={suggestionsRef}
                className="rounded-md border bg-popover shadow-md z-50 max-h-40 overflow-y-auto"
              >
                {suggestions.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onMouseDown={(e) => { e.preventDefault(); addTag(s); }}
                    className="w-full px-3 py-2 text-left text-sm hover:bg-accent hover:text-accent-foreground"
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}
            <p className="text-xs text-muted-foreground">Press Enter to create · select suggestions · max {MAX_TAGS}</p>
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? (isEdit ? "Saving…" : "Adding…") : (isEdit ? "Save Changes" : "Add Contact")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}