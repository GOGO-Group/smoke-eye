import { useEffect, useState } from "react";
import { Box, Button, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle, IconButton, Tooltip, Typography } from "@mui/material";
import MinimizeIcon from "@mui/icons-material/Minimize";
import CropSquareIcon from "@mui/icons-material/CropSquare";
import FilterNoneIcon from "@mui/icons-material/FilterNone";
import CloseIcon from "@mui/icons-material/Close";
import ShieldIcon from "@mui/icons-material/Shield";
import Brightness4Icon from "@mui/icons-material/Brightness4";
import Brightness7Icon from "@mui/icons-material/Brightness7";
import OpacitySlider from "./OpacitySlider";
import { useApp } from "../context/AppContext";

const drag = { WebkitAppRegion: "drag" };
const noDrag = { WebkitAppRegion: "no-drag" };

export default function TitleBar({ title = "Interview Support", children }) {
  const [maximized, setMaximized] = useState(false);
  const [shielded, setShielded] = useState(true);
  const [confirmClose, setConfirmClose] = useState(false);
  const { themeMode, toggleTheme } = useApp();

  useEffect(() => {
    window.api.winIsMaximized().then(setMaximized);
    window.api.onWinState((s) => setMaximized(s.maximized));
    window.api.onProtectionState((v) => setShielded(v));
  }, []);

  const toggleShield = () => {
    const next = !shielded;
    setShielded(next);
    window.api.winContentProtection(next);
  };

  return (
    <Box
      sx={{
        ...drag,
        height: 36,
        display: "flex",
        alignItems: "center",
        bgcolor: "background.paper",
        borderBottom: 1,
        borderColor: "divider",
        pl: 1.5,
        flexShrink: 0,
      }}
    >
      <Typography variant="body2" fontWeight={600} sx={{ mr: 2 }}>
        {title}
      </Typography>

      <Box sx={{ ...noDrag, display: "flex", gap: 0.5, alignItems: "center" }}>
        {children}
      </Box>

      <Box sx={{ flex: 1 }} />

      <Box sx={{ ...noDrag, display: "flex", alignItems: "center" }}>
        <OpacitySlider />
      </Box>

      <Tooltip title={themeMode === 'dark' ? "Switch to Day mode" : "Switch to Night mode"}>
        <IconButton size="small" onClick={toggleTheme} sx={{ ...noDrag, mr: 0.5 }}>
          {themeMode === 'dark'
            ? <Brightness7Icon sx={{ fontSize: 16, color: 'text.secondary' }} />
            : <Brightness4Icon sx={{ fontSize: 16, color: 'text.secondary' }} />}
        </IconButton>
      </Tooltip>

      <Tooltip title={shielded ? "Protection ON" : "Protection OFF"}>
        <IconButton
          size="small"
          onClick={toggleShield}
          sx={{ ...noDrag, mr: 0.5 }}
        >
          <ShieldIcon
            sx={{
              fontSize: 16,
              color: shielded ? "warning.main" : "text.secondary",
            }}
          />
        </IconButton>
      </Tooltip>

      <Box sx={{ ...noDrag, display: "flex" }}>
        <WinBtn onClick={() => window.api.winCtrl("minimize")}>
          <MinimizeIcon sx={{ fontSize: 16 }} />
        </WinBtn>
        <WinBtn onClick={() => window.api.winCtrl("maximize")}>
          {maximized ? (
            <FilterNoneIcon sx={{ fontSize: 13 }} />
          ) : (
            <CropSquareIcon sx={{ fontSize: 15 }} />
          )}
        </WinBtn>
        <WinBtn onClick={() => setConfirmClose(true)} danger>
          <CloseIcon sx={{ fontSize: 17 }} />
        </WinBtn>
      </Box>

      <Dialog
        open={confirmClose}
        onClose={() => setConfirmClose(false)}
        PaperProps={{ sx: { WebkitAppRegion: 'no-drag' } }}
      >
        <DialogTitle>Exit application?</DialogTitle>
        <DialogContent>
          <DialogContentText>Are you sure you want to close the program?</DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmClose(false)}>Cancel</Button>
          <Button variant="contained" color="error" onClick={() => window.api.winCtrl("close")}>Exit</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

function WinBtn({ children, onClick, danger }) {
  return (
    <IconButton
      onClick={onClick}
      size="small"
      sx={{
        width: 44,
        height: 36,
        borderRadius: 0,
        "&:hover": {
          bgcolor: danger ? "error.main" : "action.hover",
          color: danger ? "#fff" : "inherit",
        },
      }}
    >
      {children}
    </IconButton>
  );
}
