export class CreatePostDto {
  title: string;
  content: string;
  status?: 'publish' | 'draft' | 'pending' | 'private';
  categories?: number[];
  tags?: number[];
  featured_media?: number;
  excerpt?: string;
  slug?: string;
}

export class UpdatePostDto {
  title?: string;
  content?: string;
  status?: 'publish' | 'draft' | 'pending' | 'private';
  categories?: number[];
  tags?: number[];
  featured_media?: number;
  excerpt?: string;
  slug?: string;
}
