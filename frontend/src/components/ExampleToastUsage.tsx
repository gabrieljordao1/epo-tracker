"use client";

/**
 * Example Component: Toast & Error Boundary Usage
 *
 * This file demonstrates best practices for using the toast notification system
 * and API client throughout your application. Delete or repurpose this file
 * once you've integrated the patterns into your components.
 */

import { useToast } from "@/components/Toast";
import { apiClient } from "@/lib/apiClient";
import { useState } from "react";

interface Employee {
  id: string;
  name: string;
  email: string;
  department: string;
}

export function ExampleToastUsage() {
  const toast = useToast();
  const [loading, setLoading] = useState(false);
  const [employees, setEmployees] = useState<Employee[]>([]);

  // Example 1: Simple toast notifications
  const handleSimpleToasts = () => {
    toast.info("Processing your request...");
  };

  // Example 2: API call with automatic error handling
  const fetchEmployees = async () => {
    try {
      setLoading(true);
      const data = await apiClient.get<Employee[]>("/api/employees");
      setEmployees(data);
      toast.success(`Loaded ${data.length} employees`);
    } catch (error) {
      // apiClient already handles the error toast for 401, 429, 500
      console.error("Failed to fetch employees:", error);
    } finally {
      setLoading(false);
    }
  };

  // Example 3: POST request
  const createEmployee = async (
    name: string,
    email: string,
    department: string
  ) => {
    try {
      setLoading(true);
      const newEmployee = await apiClient.post<Employee>("/api/employees", {
        name,
        email,
        department,
      });
      setEmployees([...employees, newEmployee]);
      toast.success(`Employee ${name} created successfully!`);
    } catch (error) {
      console.error("Failed to create employee:", error);
    } finally {
      setLoading(false);
    }
  };

  // Example 4: PUT request (update)
  const updateEmployee = async (
    id: string,
    updates: Partial<Employee>
  ) => {
    try {
      setLoading(true);
      const updated = await apiClient.put<Employee>(
        `/api/employees/${id}`,
        updates
      );
      setEmployees(
        employees.map((emp) => (emp.id === id ? updated : emp))
      );
      toast.success("Employee updated successfully");
    } catch (error) {
      console.error("Failed to update employee:", error);
    } finally {
      setLoading(false);
    }
  };

  // Example 5: DELETE request
  const deleteEmployee = async (id: string) => {
    try {
      setLoading(true);
      await apiClient.delete(`/api/employees/${id}`);
      setEmployees(employees.filter((emp) => emp.id !== id));
      toast.success("Employee deleted successfully");
    } catch (error) {
      console.error("Failed to delete employee:", error);
    } finally {
      setLoading(false);
    }
  };

  // Example 6: Error handling with custom messages
  const handleFormSubmit = async (formData: FormData) => {
    try {
      setLoading(true);
      const response = await apiClient.post("/api/employees", {
        name: formData.get("name"),
        email: formData.get("email"),
        department: formData.get("department"),
      });

      toast.success("Form submitted successfully!");
      return response;
    } catch (error) {
      // apiClient shows toast for HTTP errors
      // For validation or custom errors, you might want to add more detail:
      if (error instanceof Error && error.message.includes("validation")) {
        toast.warning("Please check your form for errors");
      }
      throw error;
    } finally {
      setLoading(false);
    }
  };

  // Example 7: Async operation with toast feedback
  const simulateLongOperation = async () => {
    toast.info("Starting operation...");

    try {
      // Simulate API delay
      await new Promise((resolve) => setTimeout(resolve, 2000));

      // Success
      toast.success("Operation completed successfully!");
    } catch (error) {
      toast.error("Operation failed. Please try again.");
    }
  };

  return (
    <div className="space-y-4 p-6 bg-gray-900 rounded-lg">
      <h2 className="text-2xl font-bold text-white">Toast Usage Examples</h2>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Simple Toasts */}
        <section className="space-y-2">
          <h3 className="text-lg font-semibold text-white">Simple Toasts</h3>
          <button
            onClick={() => toast.success("Operation successful!")}
            className="w-full px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded transition"
          >
            Success Toast
          </button>
          <button
            onClick={() => toast.error("Something went wrong!")}
            className="w-full px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded transition"
          >
            Error Toast
          </button>
          <button
            onClick={() => toast.warning("This is a warning", 7000)}
            className="w-full px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded transition"
          >
            Warning Toast (7s)
          </button>
          <button
            onClick={handleSimpleToasts}
            className="w-full px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded transition"
          >
            Info Toast
          </button>
        </section>

        {/* API Examples */}
        <section className="space-y-2">
          <h3 className="text-lg font-semibold text-white">API Operations</h3>
          <button
            onClick={fetchEmployees}
            disabled={loading}
            className="w-full px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white rounded transition"
          >
            {loading ? "Loading..." : "Fetch Employees (GET)"}
          </button>
          <button
            onClick={() =>
              createEmployee(
                "John Doe",
                "john@example.com",
                "Engineering"
              )
            }
            disabled={loading}
            className="w-full px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white rounded transition"
          >
            {loading ? "Creating..." : "Create Employee (POST)"}
          </button>
          <button
            onClick={() =>
              updateEmployee("1", {
                name: "Jane Doe",
                department: "Product",
              })
            }
            disabled={loading}
            className="w-full px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white rounded transition"
          >
            {loading ? "Updating..." : "Update Employee (PUT)"}
          </button>
          <button
            onClick={() => deleteEmployee("1")}
            disabled={loading}
            className="w-full px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white rounded transition"
          >
            {loading ? "Deleting..." : "Delete Employee (DELETE)"}
          </button>
        </section>
      </div>

      {/* Long Operation Example */}
      <div className="mt-6 pt-6 border-t border-gray-700">
        <button
          onClick={simulateLongOperation}
          disabled={loading}
          className="w-full px-4 py-2 bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white rounded transition"
        >
          {loading ? "Processing..." : "Simulate Long Operation"}
        </button>
      </div>

      {/* Results */}
      {employees.length > 0 && (
        <div className="mt-6 pt-6 border-t border-gray-700">
          <h3 className="text-lg font-semibold text-white mb-3">
            Loaded Employees ({employees.length})
          </h3>
          <div className="space-y-2">
            {employees.map((emp) => (
              <div
                key={emp.id}
                className="bg-gray-800 p-3 rounded border border-gray-700"
              >
                <p className="text-white font-medium">{emp.name}</p>
                <p className="text-gray-400 text-sm">{emp.email}</p>
                <p className="text-gray-500 text-xs">{emp.department}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Documentation */}
      <div className="mt-6 pt-6 border-t border-gray-700">
        <h3 className="text-lg font-semibold text-white mb-2">Key Patterns</h3>
        <ul className="text-gray-300 text-sm space-y-1">
          <li>• Use useToast hook for notifications in components</li>
          <li>• Use apiClient for all API calls (auto-handles errors)</li>
          <li>• Wrap try-catch with loading state management</li>
          <li>• API errors automatically show toast notifications</li>
          <li>• Customize duration: toast.success(msg, 7000) for 7 seconds</li>
          <li>• Error boundary catches React render errors</li>
        </ul>
      </div>
    </div>
  );
}
