export interface Reservation {
  id: number;
  name: string;
  date: string;
  guests: number;
  comment: string;
  status: 'confirmed' | 'cancelled';
  createdAt: string;
}

export interface ReservationForm {
  name: string;
  date: string;
  guests: number;
  comment: string;
}
