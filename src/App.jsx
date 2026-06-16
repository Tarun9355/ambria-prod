import { Routes, Route } from "react-router-dom";
import Home from "./pages/Home.jsx";
import Studio from "./pages/Studio.jsx";
import IMS from "./pages/IMS.jsx";

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/studio" element={<Studio />} />
      <Route path="/ims" element={<IMS />} />
    </Routes>
  );
}
