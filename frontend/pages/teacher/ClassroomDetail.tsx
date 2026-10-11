import React, { useEffect, useState } from 'react';

export default function ClassroomDetail() {
  const [tests, setTests] = useState([]);
  
  useEffect(() => {
    fetch('/api/tests', {
      headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
    })
      .then(res => res.json())
      .then(res => setTests(res.data || []));
  }, []);

  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold mb-4">Classroom Detail</h1>
      <a href="/teacher/TestCreate" className="bg-blue-500 text-white p-2 rounded mb-4 inline-block">Create New Test</a>
      <h2 className="text-xl font-bold mt-4">Associated Tests:</h2>
      <ul className="list-disc pl-5">
        {tests.map((t: any) => (
          <li key={t.id}>{t.title}</li>
        ))}
      </ul>
    </div>
  );
}
