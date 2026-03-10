import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface AddHoldingDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAdd: (ticker: string, shares: number, avgCost: number) => Promise<void>;
  editValues?: { ticker: string; shares: number; avgCost: number } | null;
}

export function AddHoldingDialog({
  open,
  onOpenChange,
  onAdd,
  editValues,
}: AddHoldingDialogProps) {
  const [ticker, setTicker] = useState(editValues?.ticker ?? "");
  const [shares, setShares] = useState(editValues?.shares?.toString() ?? "");
  const [avgCost, setAvgCost] = useState(editValues?.avgCost?.toString() ?? "");
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ticker || !shares || !avgCost) return;
    setSubmitting(true);
    try {
      await onAdd(ticker.toUpperCase(), parseFloat(shares), parseFloat(avgCost));
      setTicker("");
      setShares("");
      setAvgCost("");
      onOpenChange(false);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {editValues ? "Edit Holding" : "Add Manual Holding"}
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="ticker">Ticker</Label>
            <Input
              id="ticker"
              placeholder="e.g. AAPL"
              value={ticker}
              onChange={(e) => setTicker(e.target.value)}
              disabled={!!editValues}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="shares">Shares</Label>
            <Input
              id="shares"
              type="number"
              step="any"
              placeholder="e.g. 10"
              value={shares}
              onChange={(e) => setShares(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="avgCost">Average Cost ($)</Label>
            <Input
              id="avgCost"
              type="number"
              step="any"
              placeholder="e.g. 150.00"
              value={avgCost}
              onChange={(e) => setAvgCost(e.target.value)}
            />
          </div>
          <Button type="submit" className="w-full" disabled={submitting}>
            {submitting ? "Saving..." : editValues ? "Update" : "Add Holding"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
