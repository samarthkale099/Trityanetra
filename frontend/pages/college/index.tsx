import React, { useEffect, useState } from 'react';

export default function CollegePage() {
  const [colleges, setColleges] = useState([]);

  useEffect(() => {
    fetch('/api/colleges', {
      headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
    })
      .then(res => res.json())
      .then(res => setColleges(res.data || []));
  }, []);

  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold mb-4">College Management</h1>
      <p className="mb-4">This page is only accessible by ADMIN roles.</p>
      <ul className="list-disc pl-5">
        {colleges.map((c: any) => (
          <li key={c.id}>{c.name} ({c.code})</li>
        ))}
      </ul>
    </div>
  );
}
