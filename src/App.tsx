import { BrowserRouter as Router, Routes, Route } from "react-router-dom";
import Navbar from "@/components/layout/Navbar";
import Footer from "@/components/layout/Footer";
import Home from "@/pages/Home";
import SwordList from "@/pages/SwordList";
import SwordDetail from "@/pages/SwordDetail";
import SwordsmanList from "@/pages/SwordsmanList";
import SectList from "@/pages/SectList";
import Atlas from "@/pages/Atlas";

export default function App() {
  return (
    <Router>
      <div className="min-h-screen flex flex-col bg-ink-100">
        <Navbar />
        <main className="flex-1">
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/swords" element={<SwordList />} />
            <Route path="/swords/:id" element={<SwordDetail />} />
            <Route path="/swordsmen" element={<SwordsmanList />} />
            <Route path="/sects" element={<SectList />} />
            <Route path="/atlas" element={<Atlas />} />
          </Routes>
        </main>
        <Footer />
      </div>
    </Router>
  );
}
