// Import Firebase modules
import { initializeApp } from "https://www.gstatic.com/firebasejs/9.15.0/firebase-app.js";
import {
  getFirestore,
  collection,
  addDoc,
  doc,
  updateDoc,
  deleteDoc,
  onSnapshot,
  query,
  orderBy,
  getDoc
} from "https://www.gstatic.com/firebasejs/9.15.0/firebase-firestore.js";

// Firebase configuration (replace with your own config)
const firebaseConfig = {
  apiKey: "AIzaSyCBg6RQXIiC2BKE2HjzochEeiajc7fBnZA",
  authDomain: "bookswap-bac8b.firebaseapp.com",
  projectId: "bookswap-bac8b",
  storageBucket: "bookswap-bac8b.firebasestorage.app",
  messagingSenderId: "145814837614",
  appId: "1:145814837614:web:7d52eb3c29fe659688097f",
  measurementId: "G-Q33CEMLPZ5"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// Generate a unique identifier for the user if not already set.
let currentUser = localStorage.getItem('ownerId');
if (!currentUser) {
  currentUser = (crypto.randomUUID && crypto.randomUUID()) || Math.random().toString(36).substr(2, 9);
  localStorage.setItem('ownerId', currentUser);
}
console.log("Current User ID:", currentUser);

// --- BookManager Object ---
const BookManager = {
  MAX_IMAGES: 5,
  MAX_SIZE_MB: 2,

  processImage(file) {
    return new Promise((resolve, reject) => {
      if (file.size > this.MAX_SIZE_MB * 1024 * 1024) {
        reject(new Error(`Image exceeds ${this.MAX_SIZE_MB}MB`));
        return;
      }
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error('Error reading image'));
      reader.readAsDataURL(file);
    });
  },

  async handleImages(files) {
    try {
      const images = await Promise.all(
        Array.from(files)
          .slice(0, this.MAX_IMAGES)
          .map(file =>
            this.processImage(file).then(src => ({ src, name: file.name }))
          )
      );
      return images;
    } catch (error) {
      throw new Error(error.message);
    }
  },

  async saveListing(formData, files, existingId = null) {
    try {
      let images = [];
      if (existingId) {
        const docSnap = await getDoc(doc(db, "books", existingId));
        images = docSnap.exists() ? docSnap.data().images : [];
      }
      if (files.length > 0 || !existingId) {
        const processedImages = await this.handleImages(files);
        images = processedImages.map(imgObj => imgObj.src);
      }
      const bookData = {
        owner: currentUser,
        title: formData.title.trim(),
        author: formData.author.trim(),
        price: parseFloat(formData.price),
        condition: formData.condition,
        location: formData.location.trim(),
        phone: formData.phone.replace(/\D/g, '').slice(0, 10),
        images,
        timestamp: new Date().toISOString()
      };

      if (isNaN(bookData.price) || bookData.price <= 0) {
        throw new Error('Please enter a valid price');
      }
      
      if (existingId) {
        await updateDoc(doc(db, "books", existingId), bookData);
        return existingId;
      } else {
        const docRef = await addDoc(collection(db, "books"), bookData);
        return docRef.id;
      }
    } catch (error) {
      alert(`Error: ${error.message}`);
      console.error("saveListing error:", error);
      return null;
    }
  },

  async deleteListing(id) {
    try {
      if (confirm("Are you sure you want to delete this listing?")) {
        await deleteDoc(doc(db, "books", id));
        alert('Listing deleted successfully');
      }
    } catch (error) {
      alert(`Deletion failed: ${error.message}`);
      console.error("deleteListing error:", error);
    }
  }
};

// --- Buy Page Implementation ---
async function initializeBuyPage() {
  const bookGrid = document.getElementById('bookGrid');
  const searchInput = document.getElementById('searchInput');
  const nearMeBtn = document.getElementById('nearMeBtn');

  if (!bookGrid) {
    console.error("Element with ID 'bookGrid' not found.");
    return;
  }

  // Store all books locally for faster search filtering.
  let allBooks = [];

  // Helper function to render books
  function renderBooks(books) {
    bookGrid.innerHTML = books.map(createBookCard).join('');
    highlightNewBook();
  }

  // Listen for Firestore updates
  const q = query(collection(db, "books"), orderBy("timestamp", "desc"));
  onSnapshot(q, (snapshot) => {
    if (snapshot.empty) {
      bookGrid.innerHTML = "<p>No books available</p>";
      allBooks = [];
      return;
    }
    allBooks = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    renderBooks(allBooks);
  });

  // Search functionality using the local allBooks array
  searchInput.addEventListener('input', () => {
    const searchTerm = searchInput.value.toLowerCase().trim();
    const filteredBooks = allBooks.filter(book =>
      book.title.toLowerCase().includes(searchTerm) ||
      book.author.toLowerCase().includes(searchTerm)
    );
    if (filteredBooks.length === 0) {
      bookGrid.innerHTML = "<p>No matching books found</p>";
    } else {
      renderBooks(filteredBooks);
    }
  });

  // Helper: Reverse geocode to get city name from coordinates using Nominatim API
  async function getCityFromCoordinates(lat, lon) {
    try {
      const response = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lon}`);
      const data = await response.json();
      // Try to use city, town, or village name
      return data.address.city || data.address.town || data.address.village || "";
    } catch (e) {
      console.error("Reverse geocoding failed", e);
      return "";
    }
  }

  // Helper: Sort books so that those matching the detected city come first
  function sortBooksByProximity(city) {
    if (!city) return;
    const sortedBooks = [...allBooks].sort((a, b) => {
      const scoreA = a.location.toLowerCase().includes(city.toLowerCase()) ? 1 : 0;
      const scoreB = b.location.toLowerCase().includes(city.toLowerCase()) ? 1 : 0;
      // Books with a match (score 1) come first
      return scoreB - scoreA;
    });
    renderBooks(sortedBooks);
  }

  // Near Me button functionality
  if (nearMeBtn) {
    nearMeBtn.addEventListener('click', () => {
      if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(async (position) => {
          const lat = position.coords.latitude;
          const lon = position.coords.longitude;
          const city = await getCityFromCoordinates(lat, lon);
          if (city) {
            sortBooksByProximity(city);
            alert(`Showing books near ${city}`);
          } else {
            alert("Could not determine your city from location.");
          }
        }, (error) => {
          alert("Geolocation error: " + error.message);
        });
      } else {
        alert("Geolocation is not supported by your browser.");
      }
    });
  }

  // Helper: Highlight new book if applicable
  function highlightNewBook() {
    const urlParams = new URLSearchParams(window.location.search);
    const newId = urlParams.get('new');
    if (newId) {
      history.replaceState(null, '', 'buy.html');
      const newBookCard = document.querySelector(`[data-id="${newId}"]`);
      if (newBookCard) {
        newBookCard.scrollIntoView({ behavior: 'smooth' });
        newBookCard.style.animation = 'highlightPulse 1.5s ease 2';
      }
    }
  }
}

// Helper: Create HTML for a single book card
function createBookCard(book) {
  return `
    <div class="book-card" data-id="${book.id}">
      <div class="book-images">
        ${book.images.map(src => `<img src="${src}" class="book-image" alt="${book.title} cover">`).join('')}
      </div>
      <div class="book-details">
        <h3>${book.title}</h3>
        <p class="book-author">By ${book.author}</p>
        <div class="book-meta">
          <span class="book-price">₹${parseFloat(book.price).toFixed(2)}</span>
          <span class="book-condition">${book.condition}</span>
        </div>
        <div class="book-location">📍 ${book.location}</div>
        <div class="book-contact">📞 ${book.phone}</div>
        ${
          (book.owner === currentUser)
            ? `<div class="owner-controls">
                 <button class="edit-btn" onclick="location.href='sell.html?edit=${book.id}'">Edit</button>
                 <button class="delete-btn" onclick="BookManager.deleteListing('${book.id}')">Delete</button>
               </div>`
            : ""
        }
      </div>
    </div>
  `;
}

// Initialize pages on DOMContentLoaded
document.addEventListener('DOMContentLoaded', () => {
  // Only initialize the buy page if the bookGrid exists.
  if (document.getElementById('bookGrid')) initializeBuyPage();
});

// Expose BookManager globally for inline HTML calls
window.BookManager = BookManager;
