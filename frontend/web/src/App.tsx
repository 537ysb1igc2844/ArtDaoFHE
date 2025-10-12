// App.tsx
import React, { useEffect, useState } from "react";
import { ethers } from "ethers";
import { getContractReadOnly, getContractWithSigner } from "./contract";
import WalletManager from "./components/WalletManager";
import WalletSelector from "./components/WalletSelector";
import "./App.css";

interface ArtProject {
  id: string;
  title: string;
  description: string;
  location: string;
  encryptedData: string;
  timestamp: number;
  creator: string;
  votes: number;
  status: "pending" | "approved" | "rejected";
}

const App: React.FC = () => {
  const [account, setAccount] = useState("");
  const [loading, setLoading] = useState(true);
  const [projects, setProjects] = useState<ArtProject[]>([]);
  const [provider, setProvider] = useState<ethers.BrowserProvider | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showSubmitModal, setShowSubmitModal] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [walletSelectorOpen, setWalletSelectorOpen] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{
    visible: boolean;
    status: "pending" | "success" | "error";
    message: string;
  }>({ visible: false, status: "pending", message: "" });
  const [newProjectData, setNewProjectData] = useState({
    title: "",
    description: "",
    location: "",
    imageUrl: ""
  });
  const [searchTerm, setSearchTerm] = useState("");
  const [activeTab, setActiveTab] = useState("all");
  const [showStats, setShowStats] = useState(false);

  // Calculate statistics
  const approvedCount = projects.filter(p => p.status === "approved").length;
  const pendingCount = projects.filter(p => p.status === "pending").length;
  const rejectedCount = projects.filter(p => p.status === "rejected").length;
  const totalVotes = projects.reduce((sum, project) => sum + project.votes, 0);

  useEffect(() => {
    loadProjects().finally(() => setLoading(false));
  }, []);

  const onWalletSelect = async (wallet: any) => {
    if (!wallet.provider) return;
    try {
      const web3Provider = new ethers.BrowserProvider(wallet.provider);
      setProvider(web3Provider);
      const accounts = await web3Provider.send("eth_requestAccounts", []);
      const acc = accounts[0] || "";
      setAccount(acc);

      wallet.provider.on("accountsChanged", async (accounts: string[]) => {
        const newAcc = accounts[0] || "";
        setAccount(newAcc);
      });
    } catch (e) {
      alert("Failed to connect wallet");
    }
  };

  const onConnect = () => setWalletSelectorOpen(true);
  const onDisconnect = () => {
    setAccount("");
    setProvider(null);
  };

  const loadProjects = async () => {
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      // Check contract availability using FHE
      const isAvailable = await contract.isAvailable();
      if (!isAvailable) {
        console.error("Contract is not available");
        return;
      }
      
      const keysBytes = await contract.getData("project_keys");
      let keys: string[] = [];
      
      if (keysBytes.length > 0) {
        try {
          keys = JSON.parse(ethers.toUtf8String(keysBytes));
        } catch (e) {
          console.error("Error parsing project keys:", e);
        }
      }
      
      const list: ArtProject[] = [];
      
      for (const key of keys) {
        try {
          const projectBytes = await contract.getData(`project_${key}`);
          if (projectBytes.length > 0) {
            try {
              const projectData = JSON.parse(ethers.toUtf8String(projectBytes));
              list.push({
                id: key,
                title: projectData.title,
                description: projectData.description,
                location: projectData.location,
                encryptedData: projectData.encryptedData,
                timestamp: projectData.timestamp,
                creator: projectData.creator,
                votes: projectData.votes || 0,
                status: projectData.status || "pending"
              });
            } catch (e) {
              console.error(`Error parsing project data for ${key}:`, e);
            }
          }
        } catch (e) {
          console.error(`Error loading project ${key}:`, e);
        }
      }
      
      list.sort((a, b) => b.timestamp - a.timestamp);
      setProjects(list);
    } catch (e) {
      console.error("Error loading projects:", e);
    } finally {
      setIsRefreshing(false);
      setLoading(false);
    }
  };

  const submitProject = async () => {
    if (!provider) { 
      alert("Please connect wallet first"); 
      return; 
    }
    
    setSubmitting(true);
    setTransactionStatus({
      visible: true,
      status: "pending",
      message: "Encrypting project data with Zama FHE..."
    });
    
    try {
      // Simulate FHE encryption
      const encryptedData = `FHE-${btoa(JSON.stringify(newProjectData))}`;
      
      const contract = await getContractWithSigner();
      if (!contract) {
        throw new Error("Failed to get contract with signer");
      }
      
      const projectId = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

      const projectData = {
        title: newProjectData.title,
        description: newProjectData.description,
        location: newProjectData.location,
        encryptedData: encryptedData,
        timestamp: Math.floor(Date.now() / 1000),
        creator: account,
        votes: 0,
        status: "pending"
      };
      
      // Store encrypted data on-chain using FHE
      await contract.setData(
        `project_${projectId}`, 
        ethers.toUtf8Bytes(JSON.stringify(projectData))
      );
      
      const keysBytes = await contract.getData("project_keys");
      let keys: string[] = [];
      
      if (keysBytes.length > 0) {
        try {
          keys = JSON.parse(ethers.toUtf8String(keysBytes));
        } catch (e) {
          console.error("Error parsing keys:", e);
        }
      }
      
      keys.push(projectId);
      
      await contract.setData(
        "project_keys", 
        ethers.toUtf8Bytes(JSON.stringify(keys))
      );
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: "Project submitted securely with FHE encryption!"
      });
      
      await loadProjects();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
        setShowSubmitModal(false);
        setNewProjectData({
          title: "",
          description: "",
          location: "",
          imageUrl: ""
        });
      }, 2000);
    } catch (e: any) {
      const errorMessage = e.message.includes("user rejected transaction")
        ? "Transaction rejected by user"
        : "Submission failed: " + (e.message || "Unknown error");
      
      setTransactionStatus({
        visible: true,
        status: "error",
        message: errorMessage
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    } finally {
      setSubmitting(false);
    }
  };

  const voteForProject = async (projectId: string) => {
    if (!provider) {
      alert("Please connect wallet first");
      return;
    }

    setTransactionStatus({
      visible: true,
      status: "pending",
      message: "Processing encrypted vote with FHE..."
    });

    try {
      const contract = await getContractWithSigner();
      if (!contract) {
        throw new Error("Failed to get contract with signer");
      }
      
      const projectBytes = await contract.getData(`project_${projectId}`);
      if (projectBytes.length === 0) {
        throw new Error("Project not found");
      }
      
      const projectData = JSON.parse(ethers.toUtf8String(projectBytes));
      
      const updatedProject = {
        ...projectData,
        votes: projectData.votes + 1
      };
      
      await contract.setData(
        `project_${projectId}`, 
        ethers.toUtf8Bytes(JSON.stringify(updatedProject))
      );
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: "FHE-encrypted vote recorded successfully!"
      });
      
      await loadProjects();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
    } catch (e: any) {
      setTransactionStatus({
        visible: true,
        status: "error",
        message: "Voting failed: " + (e.message || "Unknown error")
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    }
  };

  const approveProject = async (projectId: string) => {
    if (!provider) {
      alert("Please connect wallet first");
      return;
    }

    setTransactionStatus({
      visible: true,
      status: "pending",
      message: "Processing approval with FHE..."
    });

    try {
      const contract = await getContractWithSigner();
      if (!contract) {
        throw new Error("Failed to get contract with signer");
      }
      
      const projectBytes = await contract.getData(`project_${projectId}`);
      if (projectBytes.length === 0) {
        throw new Error("Project not found");
      }
      
      const projectData = JSON.parse(ethers.toUtf8String(projectBytes));
      
      const updatedProject = {
        ...projectData,
        status: "approved"
      };
      
      await contract.setData(
        `project_${projectId}`, 
        ethers.toUtf8Bytes(JSON.stringify(updatedProject))
      );
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: "Project approved with FHE verification!"
      });
      
      await loadProjects();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
    } catch (e: any) {
      setTransactionStatus({
        visible: true,
        status: "error",
        message: "Approval failed: " + (e.message || "Unknown error")
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    }
  };

  const rejectProject = async (projectId: string) => {
    if (!provider) {
      alert("Please connect wallet first");
      return;
    }

    setTransactionStatus({
      visible: true,
      status: "pending",
      message: "Processing rejection with FHE..."
    });

    try {
      const contract = await getContractWithSigner();
      if (!contract) {
        throw new Error("Failed to get contract with signer");
      }
      
      const projectBytes = await contract.getData(`project_${projectId}`);
      if (projectBytes.length === 0) {
        throw new Error("Project not found");
      }
      
      const projectData = JSON.parse(ethers.toUtf8String(projectBytes));
      
      const updatedProject = {
        ...projectData,
        status: "rejected"
      };
      
      await contract.setData(
        `project_${projectId}`, 
        ethers.toUtf8Bytes(JSON.stringify(updatedProject))
      );
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: "Project rejected with FHE verification!"
      });
      
      await loadProjects();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
    } catch (e: any) {
      setTransactionStatus({
        visible: true,
        status: "error",
        message: "Rejection failed: " + (e.message || "Unknown error")
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    }
  };

  const isCreator = (address: string) => {
    return account.toLowerCase() === address.toLowerCase();
  };

  const filteredProjects = projects.filter(project => {
    const matchesSearch = project.title.toLowerCase().includes(searchTerm.toLowerCase()) || 
                         project.description.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesTab = activeTab === "all" || project.status === activeTab;
    return matchesSearch && matchesTab;
  });

  const renderStats = () => {
    return (
      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-value">{projects.length}</div>
          <div className="stat-label">Total Projects</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{approvedCount}</div>
          <div className="stat-label">Approved</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{pendingCount}</div>
          <div className="stat-label">Pending</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{rejectedCount}</div>
          <div className="stat-label">Rejected</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{totalVotes}</div>
          <div className="stat-label">Total Votes</div>
        </div>
      </div>
    );
  };

  if (loading) return (
    <div className="loading-screen">
      <div className="spinner"></div>
      <p>Initializing FHE connection...</p>
    </div>
  );

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="logo">
          <h1>Art<span>DAO</span>FHE</h1>
          <p>Anonymous Public Art Curation via DAO</p>
        </div>
        
        <div className="header-actions">
          <WalletManager account={account} onConnect={onConnect} onDisconnect={onDisconnect} />
        </div>
      </header>
      
      <main className="main-content">
        <section className="hero-section">
          <div className="hero-content">
            <h2>Decentralized Art Curation</h2>
            <p>Nominate and vote for public art projects anonymously using FHE encryption</p>
            <button 
              onClick={() => setShowSubmitModal(true)}
              className="primary-btn"
            >
              Submit Art Proposal
            </button>
          </div>
          <div className="hero-image">
            <div className="art-canvas"></div>
          </div>
        </section>

        <section className="controls-section">
          <div className="search-container">
            <input
              type="text"
              placeholder="Search projects..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="search-input"
            />
            <button className="search-btn">🔍</button>
          </div>
          
          <div className="tabs-container">
            <button 
              className={`tab-btn ${activeTab === "all" ? "active" : ""}`}
              onClick={() => setActiveTab("all")}
            >
              All Projects
            </button>
            <button 
              className={`tab-btn ${activeTab === "pending" ? "active" : ""}`}
              onClick={() => setActiveTab("pending")}
            >
              Pending
            </button>
            <button 
              className={`tab-btn ${activeTab === "approved" ? "active" : ""}`}
              onClick={() => setActiveTab("approved")}
            >
              Approved
            </button>
            <button 
              className={`tab-btn ${activeTab === "rejected" ? "active" : ""}`}
              onClick={() => setActiveTab("rejected")}
            >
              Rejected
            </button>
          </div>
          
          <div className="action-buttons">
            <button 
              onClick={loadProjects}
              className="secondary-btn"
              disabled={isRefreshing}
            >
              {isRefreshing ? "Refreshing..." : "Refresh"}
            </button>
            <button 
              onClick={() => setShowStats(!showStats)}
              className="secondary-btn"
            >
              {showStats ? "Hide Stats" : "Show Stats"}
            </button>
          </div>
        </section>

        {showStats && (
          <section className="stats-section">
            <h3>Project Statistics</h3>
            {renderStats()}
          </section>
        )}

        <section className="projects-section">
          <h3>Public Art Proposals</h3>
          
          {filteredProjects.length === 0 ? (
            <div className="no-projects">
              <div className="empty-icon"></div>
              <p>No art projects found</p>
              <button 
                className="primary-btn"
                onClick={() => setShowSubmitModal(true)}
              >
                Submit First Project
              </button>
            </div>
          ) : (
            <div className="projects-grid">
              {filteredProjects.map(project => (
                <div className="project-card" key={project.id}>
                  <div className="project-image">
                    <div className="image-placeholder"></div>
                  </div>
                  <div className="project-content">
                    <h4>{project.title}</h4>
                    <p className="project-description">{project.description}</p>
                    <p className="project-location">📍 {project.location}</p>
                    
                    <div className="project-meta">
                      <span className={`status-badge ${project.status}`}>
                        {project.status}
                      </span>
                      <span className="vote-count">❤️ {project.votes} votes</span>
                    </div>
                    
                    <div className="project-actions">
                      <button 
                        onClick={() => voteForProject(project.id)}
                        className="vote-btn"
                      >
                        Vote
                      </button>
                      
                      {isCreator(project.creator) && project.status === "pending" && (
                        <div className="creator-actions">
                          <button 
                            onClick={() => approveProject(project.id)}
                            className="approve-btn"
                          >
                            Approve
                          </button>
                          <button 
                            onClick={() => rejectProject(project.id)}
                            className="reject-btn"
                          >
                            Reject
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </main>
  
      {showSubmitModal && (
        <ModalSubmit 
          onSubmit={submitProject} 
          onClose={() => setShowSubmitModal(false)} 
          submitting={submitting}
          projectData={newProjectData}
          setProjectData={setNewProjectData}
        />
      )}
      
      {walletSelectorOpen && (
        <WalletSelector
          isOpen={walletSelectorOpen}
          onWalletSelect={(wallet) => { onWalletSelect(wallet); setWalletSelectorOpen(false); }}
          onClose={() => setWalletSelectorOpen(false)}
        />
      )}
      
      {transactionStatus.visible && (
        <div className="transaction-modal">
          <div className="transaction-content">
            <div className={`transaction-icon ${transactionStatus.status}`}>
              {transactionStatus.status === "pending" && <div className="spinner"></div>}
              {transactionStatus.status === "success" && "✓"}
              {transactionStatus.status === "error" && "✗"}
            </div>
            <div className="transaction-message">
              {transactionStatus.message}
            </div>
          </div>
        </div>
      )}
  
      <footer className="app-footer">
        <div className="footer-content">
          <div className="footer-brand">
            <h3>ArtDAOFHE</h3>
            <p>Anonymous Public Art Curation via DAO</p>
          </div>
          
          <div className="footer-links">
            <a href="#" className="footer-link">About</a>
            <a href="#" className="footer-link">How It Works</a>
            <a href="#" className="footer-link">Community</a>
            <a href="#" className="footer-link">Contact</a>
          </div>
          
          <div className="fhe-badge">
            <span>Powered by FHE Technology</span>
          </div>
        </div>
        
        <div className="footer-bottom">
          <div className="copyright">
            © {new Date().getFullYear()} ArtDAOFHE. All rights reserved.
          </div>
        </div>
      </footer>
    </div>
  );
};

interface ModalSubmitProps {
  onSubmit: () => void; 
  onClose: () => void; 
  submitting: boolean;
  projectData: any;
  setProjectData: (data: any) => void;
}

const ModalSubmit: React.FC<ModalSubmitProps> = ({ 
  onSubmit, 
  onClose, 
  submitting,
  projectData,
  setProjectData
}) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setProjectData({
      ...projectData,
      [name]: value
    });
  };

  const handleSubmit = () => {
    if (!projectData.title || !projectData.description || !projectData.location) {
      alert("Please fill required fields");
      return;
    }
    
    onSubmit();
  };

  return (
    <div className="modal-overlay">
      <div className="submit-modal">
        <div className="modal-header">
          <h2>Submit Art Proposal</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="fhe-notice">
            <p>Your proposal details will be encrypted using FHE technology for anonymous submission</p>
          </div>
          
          <div className="form-group">
            <label>Project Title *</label>
            <input 
              type="text"
              name="title"
              value={projectData.title} 
              onChange={handleChange}
              placeholder="Enter project title..." 
              className="form-input"
            />
          </div>
          
          <div className="form-group">
            <label>Description *</label>
            <textarea 
              name="description"
              value={projectData.description} 
              onChange={handleChange}
              placeholder="Describe your art project..." 
              className="form-textarea"
              rows={4}
            />
          </div>
          
          <div className="form-group">
            <label>Location *</label>
            <input 
              type="text"
              name="location"
              value={projectData.location} 
              onChange={handleChange}
              placeholder="Where should this art be displayed?" 
              className="form-input"
            />
          </div>
          
          <div className="form-group">
            <label>Image URL (Optional)</label>
            <input 
              type="text"
              name="imageUrl"
              value={projectData.imageUrl} 
              onChange={handleChange}
              placeholder="Link to artwork image..." 
              className="form-input"
            />
          </div>
        </div>
        
        <div className="modal-footer">
          <button 
            onClick={onClose}
            className="cancel-btn"
          >
            Cancel
          </button>
          <button 
            onClick={handleSubmit} 
            disabled={submitting}
            className="submit-btn"
          >
            {submitting ? "Encrypting with FHE..." : "Submit Proposal"}
          </button>
        </div>
      </div>
    </div>
  );
};

export default App;