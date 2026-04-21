"use client";

import { createContext, useContext, useState, useEffect, ReactNode } from "react";
import { getTeamMembers, getMe, getAuthToken } from "./api";

export interface TeamMember {
  id: number;
  full_name: string;
  email: string;
  role: string;
  communities: string[];
  stats?: {
    total: number;
    confirmed: number;
    pending: number;
    denied: number;
    total_value: number;
    capture_rate: number;
    needs_followup: number;
    overdue: number;
  };
  health?: string;
}

interface UserContextType {
  /** Currently active user (null = boss/admin view showing all) */
  activeUser: TeamMember | null;
  /** All team members loaded from API */
  teamMembers: TeamMember[];
  /** Set the active viewing user. null = admin/all view */
  setActiveUser: (user: TeamMember | null) => void;
  /** Whether we're in "boss mode" (seeing everything) */
  isBossView: boolean;
  /** Supervisor ID param for API calls (undefined = no filter) */
  supervisorId: number | undefined;
  /** Currently logged-in user (the boss by default for demo) */
  currentUser: TeamMember | null;
  /** Whether we're in demo mode (no auth token) */
  isDemoMode: boolean;
  /** Reload team members */
  refreshTeam: () => Promise<void>;
}

const UserContext = createContext<UserContextType>({
  activeUser: null,
  teamMembers: [],
  setActiveUser: () => {},
  isBossView: true,
  supervisorId: undefined,
  currentUser: null,
  isDemoMode: true,
  refreshTeam: async () => {},
});

const DEMO_MEMBERS: TeamMember[] = [
  { id: 1, full_name: "Gabriel Jordao", email: "gabriel@stancil.com", role: "admin", communities: ["Mallard Park", "Odell Park", "Galloway", "Cedar Hills", "Olmsted", "Ridgeview"] },
  { id: 2, full_name: "Marcus Rivera", email: "marcus@stancil.com", role: "field", communities: ["Mallard Park", "Odell Park"] },
  { id: 3, full_name: "Tyler Brooks", email: "tyler@stancil.com", role: "field", communities: ["Galloway", "Cedar Hills"] },
  { id: 4, full_name: "James Whitfield", email: "james@stancil.com", role: "field", communities: ["Olmsted", "Ridgeview"] },
];

export function UserProvider({ children }: { children: ReactNode }) {
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
  const [activeUser, setActiveUser] = useState<TeamMember | null>(null);
  const [currentUser, setCurrentUser] = useState<TeamMember | null>(null);
  const [isDemoMode, setIsDemoMode] = useState(true);

  const loadTeam = async () => {
    try {
      // First, identify the actual logged-in user via /api/auth/me
      const me = await getMe();
      const data = await getTeamMembers();
      const members: TeamMember[] = Array.isArray(data) ? data : [];
      if (members.length > 0) {
        setTeamMembers(members);
        // Find the logged-in user in the team list (match by id or email)
        const loggedInMember = members.find(
          (m) => m.id === me.id || m.email === me.email
        );
        if (loggedInMember) {
          setCurrentUser(loggedInMember);
          // Field users should always see only their own data
          if (loggedInMember.role === "field") {
            setActiveUser(loggedInMember);
          }
        } else {
          // Fallback: use the /me response directly
          const fallbackMember: TeamMember = {
            id: me.id,
            full_name: me.full_name,
            email: me.email,
            role: me.role,
            communities: [],
          };
          setCurrentUser(fallbackMember);
          if (me.role === "field") {
            setActiveUser(fallbackMember);
          }
        }
        setIsDemoMode(false);
      } else {
        throw new Error("No members");
      }
    } catch {
      setTeamMembers(DEMO_MEMBERS);
      setCurrentUser(DEMO_MEMBERS[0]);
      setIsDemoMode(true);
    }
  };

  useEffect(() => {
    loadTeam();
  }, []);

  const isBossView = activeUser === null;
  const supervisorId = activeUser && activeUser.role !== "admin" ? activeUser.id : undefined;

  return (
    <UserContext.Provider
      value={{
        activeUser,
        teamMembers,
        setActiveUser,
        isBossView,
        supervisorId,
        currentUser,
        isDemoMode,
        refreshTeam: loadTeam,
      }}
    >
      {children}
    </UserContext.Provider>
  );
}

export function useUser() {
  return useContext(UserContext);
}
