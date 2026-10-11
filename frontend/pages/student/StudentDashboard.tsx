import React, { useEffect, useState } from 'react';

export default function StudentDashboard() {
  const [classrooms, setClassrooms] = useState([]);

  useEffect(() => {
    fetch('/api/classrooms', {
      headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
    })
      .then(res => res.json())
      .then(res => setClassrooms(res.data || []));
  }, []);

  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold mb-4">Student Dashboard</h1>
      <h2 className="text-xl font-bold">My Classrooms</h2>
      <ul className="list-disc pl-5">
        {classrooms.map((c: any) => (
          <li key={c.id}>
            {c.name}
            {/* Hardcoded test navigation for demo, usually classroom detail would load tests */}
            <a href={`/student/TestLobby?testId=mock-id`} className="ml-4 text-blue-500 underline">View Tests</a>
          </li>
        ))}
      </ul>
    </div>
  );
}
