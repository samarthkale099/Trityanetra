import React, { useEffect, useState } from 'react';

export default function ClassroomList() {
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
      <h1 className="text-2xl font-bold mb-4">My Classrooms</h1>
      <ul className="list-disc pl-5">
        {classrooms.map((c: any) => (
          <li key={c.id}>
            <a href={`/teacher/ClassroomDetail?id=${c.id}`} className="text-blue-500 underline">{c.name}</a>
          </li>
        ))}
      </ul>
    </div>
  );
}
