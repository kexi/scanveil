import InfoOutlinedIcon from "@mui/icons-material/InfoOutlined";
import Dialog from "@mui/material/Dialog";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import IconButton from "@mui/material/IconButton";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableContainer from "@mui/material/TableContainer";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import { useState } from "react";

export interface LlmModelCostRank {
  displayName: string;
  estimatedCostRank: number;
  id: string;
}

export function LlmModelCostRankButton({ models }: { models: LlmModelCostRank[] }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Tooltip title="LLM cost ranks">
        <IconButton aria-label="LLM cost ranks" onClick={() => setOpen(true)} size="small">
          <InfoOutlinedIcon fontSize="small" />
        </IconButton>
      </Tooltip>
      <LlmModelCostRankDialog models={models} onClose={() => setOpen(false)} open={open} />
    </>
  );
}

function LlmModelCostRankDialog({
  models,
  onClose,
  open,
}: {
  models: LlmModelCostRank[];
  onClose(): void;
  open: boolean;
}) {
  const sortedModels = [...models].sort((left, right) => {
    const rankDifference = left.estimatedCostRank - right.estimatedCostRank;
    const hasRankDifference = rankDifference !== 0;
    if (hasRankDifference) {
      return rankDifference;
    }

    return left.displayName.localeCompare(right.displayName);
  });

  return (
    <Dialog fullWidth maxWidth="sm" onClose={onClose} open={open}>
      <DialogTitle>LLM cost ranks</DialogTitle>
      <DialogContent>
        <Typography color="text.secondary" sx={{ mb: 2 }} variant="body2">
          Smaller rank means cheaper default preference.
        </Typography>
        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Rank</TableCell>
                <TableCell>Model</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {sortedModels.map((model) => (
                <TableRow key={model.id}>
                  <TableCell>{model.estimatedCostRank}</TableCell>
                  <TableCell>
                    <Typography sx={{ fontWeight: 700 }} variant="body2">
                      {model.displayName}
                    </Typography>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </DialogContent>
    </Dialog>
  );
}
